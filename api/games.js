// api/games.js
module.exports = async (req, res) => {
    const RAWG_KEY = process.env.RAWG_KEY;
    const { tab = 'recent' } = req.query;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (!RAWG_KEY) {
        return res.status(500).json({ error: "RAWG_KEY missing" });
    }

    try {
        const now = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(now.getFullYear() - 1); // 최근 1개년 타겟
        
        const fromDate = oneYearAgo.toISOString().split('T')[0];
        const toDate = now.toISOString().split('T')[0];

        // 🎯 [GOTY 감성 거름망]
        // - platforms=187,186,4 (PS5, Xbox Series X/S, PC 대작 중심)
        // - tags=story-rich,cinematic (갓오워, 앨런웨이크, RE 시리즈 같은 영화형 대작 속성 고정)
        // - ordering=-released (최근 1년 내 출시작 최신순)
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&platforms=187,186,4&tags=story-rich,cinematic&ordering=-released&page_size=40`;
        
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        // 대작 필터링 안전장치 (관심도 유저 수 300 이상만 통과시켜 B급 이하 방어)
        let gatyGames = (rawgData.results || []).filter(game => {
            return game.added && game.added >= 300; 
        });

        // 만약 조건이 너무 빡빡해서 신작이 안 나오면 상위 데이터로 안전 방어
        if (gatyGames.length < 5) {
            gatyGames = (rawgData.results || []).slice(0, 20);
        }

        // 스팀 API 크로스 매칭으로 싱글/협동(코옵) 태그 명시하기
        const updatedGames = await Promise.all(gatyGames.map(async (game) => {
            game.tags = []; // 태그 초기화 후 정밀 주입

            try {
                const steamSearchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(game.name)}&l=korean&cc=KR`;
                const searchRes = await fetch(steamSearchUrl);
                const searchData = await searchRes.json();

                if (searchData && searchData.items && searchData.items.length > 0) {
                    const steamId = searchData.items[0].id;
                    const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${steamId}&l=korean`;
                    const steamRes = await fetch(steamApiUrl);
                    const steamData = await steamRes.json();

                    if (steamData[steamId]?.success) {
                        const details = steamData[steamId].data;
                        
                        if (details.metacritic && details.metacritic.score) {
                            game.metacritic = details.metacritic.score;
                        }

                        // 🎯 스팀 카테고리 데이터 분석 후 싱글/코옵 배지 규격 주입
                        if (details.categories) {
                            details.categories.forEach(cat => {
                                if (cat.id === 2) game.tags.push({ name: "Singleplayer", slug: "singleplayer" });
                                if (cat.id === 9 || cat.id === 24) game.tags.push({ name: "Co-op", slug: "co-op" });
                                if (cat.id === 1 || cat.id === 38) game.tags.push({ name: "Multiplayer", slug: "multiplayer" });
                            });
                        }
                    }
                }
            } catch (e) {
                // 에러 시 패스
            }

            // 스팀 검색에 안 걸리는 콘솔 독점작 등은 기본적으로 싱글플레이어 배지 부여
            if (game.tags.length === 0) {
                game.tags.push({ name: "Singleplayer", slug: "singleplayer" });
            }

            // 중복 태그 제거 및 메타 평점 예외 처리
            game.tags = Array.from(new Map(game.tags.map(item => [item.slug, item])).values());
            game.metacritic = game.metacritic || "TBD";
            
            return game;
        }));

        return res.status(200).json({ results: updatedGames.slice(0, 30) });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
