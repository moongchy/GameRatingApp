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
        const fromDate = new Date(new Date().setFullYear(now.getFullYear() - 1)).toISOString().split('T')[0];
        const toDate = new Date(new Date().setFullYear(now.getFullYear() + 1)).toISOString().split('T')[0];

        // 1. RAWG API 호출 (page_size를 15개로 줄이고 타임아웃 방어)
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&ordering=-added&page_size=15`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        const todayStr = now.toISOString().split('T')[0];
        const filteredGames = (rawgData.results || []).filter(game => {
            const isUpcoming = game.released ? game.released > todayStr : true;
            return tab === 'recent' ? (!isUpcoming && game.released) : isUpcoming;
        });

        // 2. 💡 타임아웃 방지: 메타 점수가 없는 상위 3개 게임만 골라서 아주 빠르게 스팀 연동
        let checkCount = 0;
        const updatedGames = await Promise.all(filteredGames.map(async (game) => {
            if (game.metacritic) return game; // 이미 점수가 있으면 패스
            if (checkCount >= 3) return game; // 이미 3개 조사했으면 타임아웃 방지를 위해 패스

            // 게임 이름(slug)을 기반으로 스팀 상점 API를 다이렉트로 추적 시도
            try {
                checkCount++;
                // 스팀은 게임 이름(slug) 검색 API를 지원하므로 이를 활용해 상세 데이터를 바로 찌름
                const steamSearchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(game.name)}&l=korean&cc=KR`;
                const searchRes = await fetch(steamSearchUrl);
                const searchData = await searchRes.json();

                if (searchData && searchData.items && searchData.items.length > 0) {
                    const steamId = searchData.items[0].id; // 가장 정확한 첫 번째 게임 ID 추출

                    // 스팀 상세 API 호출해서 메타점수 가져오기
                    const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${steamId}&l=korean`;
                    const steamRes = await fetch(steamApiUrl);
                    const steamData = await steamRes.json();

                    if (steamData[steamId]?.success) {
                        const details = steamData[steamId].data;
                        if (details.metacritic && details.metacritic.score) {
                            game.metacritic = details.metacritic.score; // 진짜 점수 주입!
                        }
                    }
                }
            } catch (e) {
                // 에러 나면 조용히 원래 데이터 유지
            }
            return game;
        }));

        return res.status(200).json({ results: updatedGames });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
