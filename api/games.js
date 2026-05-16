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
        // 🎯 정확히 '최근 1년 전'부터 '현재'까지로 날짜 범위를 칼같이 제한 (2025~2026년 타겟)
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(now.getFullYear() - 1);
        
        const fromDate = oneYearAgo.toISOString().split('T')[0];
        const toDate = now.toISOString().split('T')[0];

        // 🎯 1. 최근 1년간 출시된 게임을 최신 출시순(-released)으로 40개 가져옴
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&ordering=-released&page_size=40`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        // 🎯 2. AAA급 필터링: 유저 관심도 수치(added)가 최소 1,500개 이상인 검증된 대작만 추출
        const aaaGames = (rawgData.results || []).filter(game => {
            return game.added && game.added >= 1500; 
        });

        // 3. 스팀 API를 연동하여 평점 보완 및 [싱글/협동] 카테고리 명시하기
        const updatedGames = await Promise.all(aaaGames.map(async (game) => {
            // 프론트엔드가 태그를 읽을 수 있도록 배열 초기화
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

                        // 🎯 스팀 카테고리 분석 후 싱글/협동 여부를 프론트엔드 태그 포맷으로 강제 명시
                        if (details.categories) {
                            details.categories.forEach(cat => {
                                if (cat.id === 2) {
                                    game.tags.push({ name: "Singleplayer", slug: "singleplayer" });
                                }
                                if (cat.id === 9 || cat.id === 24) {
                                    game.tags.push({ name: "Co-op", slug: "co-op" });
                                }
                                if (cat.id === 1 || cat.id === 38) {
                                    game.tags.push({ name: "Multiplayer", slug: "multiplayer" });
                                }
                            });
                        }
                    }
                }
            } catch (e) {
                // 에러 시 무시
            }

            // 스팀에서 태그를 못 가져왔을 때를 대비한 RAWG 데이터 기반 자체 백업 명시
            if (game.tags.length === 0 && game.genres) {
                // 장르나 슬러그 분석을 통해 최소한의 싱글 여부 방어선 구축
                game.tags.push({ name: "Singleplayer", slug: "singleplayer" });
            }

            // 중복 태그 제거 및 메타 평점 예외 처리
            game.tags = Array.from(new Map(game.tags.map(item => [item.slug, item])).values());
            game.metacritic = game.metacritic || "TBD";
            
            return game;
        }));

        // Vercel 10초 타임아웃 방지를 위해 상위 30개만 최종 반환
        return res.status(200).json({ results: updatedGames.slice(0, 30) });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
