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
        oneYearAgo.setFullYear(now.getFullYear() - 1);
        
        const fromDate = oneYearAgo.toISOString().split('T')[0];
        const toDate = now.toISOString().split('T')[0];

        // 🎯 1. 네가 좋아하는 게임들의 공통점 저격
        // - platforms=187,186 (PS5, Xbox Series X/S 필수 출시작만 선별 -> 인디 게임 완벽 자동 차단)
        // - genres=action,role-playing-games-rpg (액션 및 RPG 장르 고정)
        // - ordering=-released (최근 1년 내 출시작 최신순 정렬)
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&platforms=187,186&genres=action,role-playing-games-rpg&ordering=-released&page_size=40`;
        
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        // 🎯 2. 현실적인 콘솔 대작 컷트라인 (유저 관심도 500 이상만 통과)
        let aaaGames = (rawgData.results || []).filter(game => {
            return game.added && game.added >= 500; 
        });

        // 기대작이나 신작 누락 방지용 안전장치 (데이터가 너무 적으면 상위 노출)
        if (aaaGames.length < 5) {
            aaaGames = (rawgData.results || []).slice(0, 15);
        }

        // 3. 스팀 API 크로스 매칭으로 싱글/협동(코옵) 태그 명시하기
        const updatedGames = await Promise.all(aaaGames.map(async (game) => {
            game.tags = [];

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

                        // 🎯 스팀 카테고리에서 싱글/코옵/멀티 정밀 추출 후 배지 데이터 주입
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
                // 에러 패스
            }

            // 스팀 검색에 안 걸리는 PS5 독점작 등의 경우, RAWG 데이터를 기반으로 싱글플레이 태그 기본 방어
            if (game.tags.length === 0) {
                game.tags.push({ name: "Singleplayer", slug: "singleplayer" });
            }

            // 중복 제거 및 메타 평점 예외 처리
            game.tags = Array.from(new Map(game.tags.map(item => [item.slug, item])).values());
            game.metacritic = game.metacritic || "TBD";
            
            return game;
        }));

        return res.status(200).json({ results: updatedGames.slice(0, 30) });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
