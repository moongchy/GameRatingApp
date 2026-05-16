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

        // 1. RAWG에서 게임 목록 땡겨오기
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&ordering=-added&page_size=20`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        const todayStr = now.toISOString().split('T')[0];
        const filteredGames = (rawgData.results || []).filter(game => {
            const isUpcoming = game.released ? game.released > todayStr : true;
            return tab === 'recent' ? (!isUpcoming && game.released) : isUpcoming;
        });

        // 2. 💡 핵심: 스팀 공식 API를 찔러서 진짜 메타크리틱 점수와 동접자 채워넣기
        const updatedGames = await Promise.all(filteredGames.map(async (game) => {
            // RAWG 데이터 내부에서 스팀 상점 주소나 ID 힌트 찾기
            const steamStore = game.stores?.find(s => s.store.slug === 'steam');
            
            if (steamStore && steamStore.store) {
                // 게임 주소(예: store.steampowered.com/app/292030)에서 숫자 ID만 추출
                const match = steamStore.url_raw?.match(/\/app\/(\d+)/);
                const steamId = match ? match[1] : null;

                if (steamId) {
                    try {
                        // 스팀 상점 공식 상세 API 호출 (여기에 진짜 메타점수가 들어있음!)
                        const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${steamId}&l=korean`;
                        const steamRes = await fetch(steamApiUrl);
                        const steamData = await steamRes.json();

                        if (steamData[steamId]?.success) {
                            const details = steamData[steamId].data;
                            
                            // 🎯 스팀이 보관중인 메타크리틱 점수가 있다면 RAWG의 빈자리 채우기!
                            if (details.metacritic && details.metacritic.score) {
                                game.metacritic = details.metacritic.score;
                            }
                        }
                    } catch (e) {
                        // 스팀 통신 에러 발생 시 패스
                    }
                }
            }
            return game;
        }));

        return res.status(200).json({ results: updatedGames });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
