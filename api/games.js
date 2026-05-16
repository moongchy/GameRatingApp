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

        // 1. RAWG에서 검증된 대작/인기 게임 목록 30개 정상적으로 가져오기
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&ordering=-added&page_size=30`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        const todayStr = now.toISOString().split('T')[0];
        const filteredGames = (rawgData.results || []).filter(game => {
            const isUpcoming = game.released ? game.released > todayStr : true;
            return tab === 'recent' ? (!isUpcoming && game.released) : isUpcoming;
        });

        // 2. 각 게임의 메타크리틱 점수를 스팀 API를 추적해서 100% 강제 동기화
        const updatedGames = await Promise.all(filteredGames.map(async (game) => {
            try {
                // 스팀 상점 API 검색을 통해 가장 정확한 스팀 AppID를 찾아냄
                const steamSearchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(game.name)}&l=korean&cc=KR`;
                const searchRes = await fetch(steamSearchUrl);
                const searchData = await searchRes.json();

                if (searchData && searchData.items && searchData.items.length > 0) {
                    const steamId = searchData.items[0].id;

                    // 스팀 상세 API를 찔러서 스팀이 보관 중인 진짜 메타크리틱 스코어 쏙 빼오기
                    const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${steamId}&l=korean`;
                    const steamRes = await fetch(steamApiUrl);
                    const steamData = await steamRes.json();

                    if (steamData[steamId]?.success) {
                        const details = steamData[steamId].data;
                        
                        // RAWG 점수는 무시하고, 스팀에 등록된 메타크리틱 점수를 최우선으로 꽂아넣기
                        if (details.metacritic && details.metacritic.score) {
                            game.metacritic = details.metacritic.score;
                        } else {
                            game.metacritic = "TBD";
                        }
                    }
                } else {
                    // 스팀에 없는 콘솔 독점작 등은 RAWG 점수가 있다면 유지, 없다면 TBD
                    game.metacritic = game.metacritic || "TBD";
                }
            } catch (e) {
                game.metacritic = game.metacritic || "TBD";
            }
            return game;
        }));

        return res.status(200).json({ results: updatedGames });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
