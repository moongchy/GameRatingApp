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

        // 1. RAWG 게임 목록 가져오기
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&ordering=-added&page_size=20`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        const todayStr = now.toISOString().split('T')[0];
        const filteredGames = (rawgData.results || []).filter(game => {
            const isUpcoming = game.released ? game.released > todayStr : true;
            return tab === 'recent' ? (!isUpcoming && game.released) : isUpcoming;
        });

        // 2. 💡 개선된 스팀 ID 추출 및 메타 점수 매칭
        const updatedGames = await Promise.all(filteredGames.map(async (game) => {
            // RAWG가 제공하는 메타 점수가 이미 있다면 굳이 스팀을 안 찌르고 통과
            if (game.metacritic) return game;

            // 스팀 상점 정보 찾기
            const steamStore = game.stores?.find(s => s.store.slug === 'steam');
            
            if (steamStore) {
                // RAWG 목록 API에서는 상점 상세 주소(url_raw)가 누락되므로, 
                // 대신 각 게임의 상점 배치 ID 정보를 활용해 상세 주소를 한 번 더 추적하거나
                // RAWG가 심어둔 game.id 자체를 활용해 스팀 연동 ID를 가져와야 함.
                try {
                    // 가장 확실한 방법: RAWG 게임 단건 상세 API를 찔러 스팀 주소 명확히 알아내기
                    const detailRes = await fetch(`https://api.rawg.io/api/games/${game.id}?key=${RAWG_KEY}`);
                    const detailData = await detailRes.json();
                    
                    const fullSteamStore = detailData.stores?.find(s => s.store.slug === 'steam');
                    const steamUrl = fullSteamStore ? (fullSteamStore.url_raw || fullSteamStore.url) : null;
                    const match = steamUrl?.match(/\/app\/(\d+)/);
                    const steamId = match ? match[1] : null;

                    if (steamId) {
                        // 스팀 공식 상점 API 호출해서 진짜 메타 점수 쏙 빼오기
                        const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${steamId}&l=korean`;
                        const steamRes = await fetch(steamApiUrl);
                        const steamData = await steamRes.json();

                        if (steamData[steamId]?.success) {
                            const details = steamData[steamId].data;
                            if (details.metacritic && details.metacritic.score) {
                                game.metacritic = details.metacritic.score; // 🎯 진짜 점수 주입!
                            }
                        }
                    }
                } catch (e) {
                    // 단건 호출 에러 발생 시 원래 데이터 유지
                }
            }
            return game;
        }));

        return res.status(200).json({ results: updatedGames });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
