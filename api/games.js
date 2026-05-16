// api/games.js
module.exports = async (req, res) => {
    const RAWG_KEY = process.env.RAWG_KEY;
    const { tab = 'recent' } = req.query;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (!RAWG_KEY) {
        return res.status(500).json({ error: "RAWG_KEY missing" });
    }

    // 🎯 [하드캐리 DB 역할] 스팀 API 데이터가 누락시켰거나 동기화가 늦는 대작 게임들의 진짜 메타 점수 수동 매칭 매트릭스
    const METACRITIC_FIX_MAP = {
        "Resident Evil Requiem": 92,
        "레지던트 이블 레퀴엠": 92,
        "바이오하자드 레퀴엠": 92,
        // 향후 또 점수 누락된 대작이 발견되면 여기에 고스란히 추가해주면 끝!
    };

    try {
        const now = new Date();
        const fromDate = new Date(new Date().setFullYear(now.getFullYear() - 1)).toISOString().split('T')[0];
        const toDate = new Date(new Date().setFullYear(now.getFullYear() + 1)).toISOString().split('T')[0];

        // 1. RAWG에서 메이저인기 게임 목록 가져오기
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&ordering=-added&page_size=30`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        const todayStr = now.toISOString().split('T')[0];
        const filteredGames = (rawgData.results || []).filter(game => {
            const isUpcoming = game.released ? game.released > todayStr : true;
            return tab === 'recent' ? (!isUpcoming && game.released) : isUpcoming;
        });

        // 2. 스팀 API 조회 및 정적 DB 크로스 매칭으로 점수 뚫어버리기
        const updatedGames = await Promise.all(filteredGames.map(async (game) => {
            // 기본값으로 RAWG 점수가 혹시라도 있으면 잡아둠
            let finalScore = game.metacritic || null;

            // 🔍 [검증 1순위] 우리가 코드 내부에 선언해둔 수동 매칭 데이터에 있는가?
            if (METACRITIC_FIX_MAP[game.name]) {
                finalScore = METACRITIC_FIX_MAP[game.name];
            } else {
                try {
                    // 게임 이름으로 스팀 검색
                    const steamSearchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(game.name)}&l=korean&cc=KR`;
                    const searchRes = await fetch(steamSearchUrl);
                    const searchData = await searchRes.json();

                    if (searchData && searchData.items && searchData.items.length > 0) {
                        const steamId = searchData.items[0].id;

                        // 스팀 상세 API 호출
                        const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${steamId}&l=korean`;
                        const steamRes = await fetch(steamApiUrl);
                        const steamData = await steamRes.json();

                        if (steamData[steamId]?.success) {
                            const details = steamData[steamId].data;
                            
                            // 🔍 [검증 2순위] 스팀 공식 API가 정상적으로 메타 스코어를 주는가?
                            if (details.metacritic && details.metacritic.score) {
                                finalScore = details.metacritic.score;
                            }
                        }
                    }
                } catch (e) {
                    // 에러 시 기존 점수 유지
                }
            }

            // 최종 매칭된 점수 주입 (없으면 TBD)
            game.metacritic = finalScore || "TBD";
            return game;
        }));

        return res.status(200).json({ results: updatedGames });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
