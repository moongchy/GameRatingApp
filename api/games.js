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
        // 1. 인터넷에 매일 백업되어 올라오는 글로벌 메타크리틱 게임 DB 파일 실시간 로드
        // (전 세계 모든 게임의 영어 제목과 메타스코어가 매일 누적 갱신되는 원격 오픈소스 데이터셋)
        const remoteDbUrl = `https://raw.githubusercontent.com/wgerard/metacritic-data/main/data/games.json`;
        let metacriticDb = [];
        try {
            const dbRes = await fetch(remoteDbUrl);
            if (dbRes.ok) {
                metacriticDb = await dbRes.json(); // [{ title: "...", score: 92, platform: "..." }, ...] 구조
            }
        } catch (dbErr) {
            console.error("원격 메타크리틱 DB 로드 실패:", dbErr);
        }

        const now = new Date();
        const fromDate = new Date(new Date().setFullYear(now.getFullYear() - 1)).toISOString().split('T')[0];
        const toDate = new Date(new Date().setFullYear(now.getFullYear() + 1)).toISOString().split('T')[0];

        // 2. RAWG에서 메이저 인기 게임 목록 가져오기
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&ordering=-added&page_size=30`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        const todayStr = now.toISOString().split('T')[0];
        const filteredGames = (rawgData.results || []).filter(game => {
            const isUpcoming = game.released ? game.released > todayStr : true;
            return tab === 'recent' ? (!isUpcoming && game.released) : isUpcoming;
        });

        // 3. 스팀 API + 원격 메타크리틱 DB 크로스 매칭
        const updatedGames = await Promise.all(filteredGames.map(async (game) => {
            let finalScore = null;

            // [Step A] 우선순위 1: 스팀 상점 API가 정상적으로 점수를 주는지 확인
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
                            finalScore = details.metacritic.score;
                        }
                    }
                }
            } catch (e) {
                // 스팀 API 에러 시 패스
            }

            // [Step B] 우선순위 2: 스팀 API가 점수를 빼먹었다면(공란), 원격 백업 DB에서 게임 이름으로 검색
            if (!finalScore && metacriticDb.length > 0) {
                // 대소문자 및 공백 제거 후 정밀 비교 매칭
                const targetName = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                const matchedGame = metacriticDb.find(dbGame => {
                    const dbName = dbGame.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return dbName === targetName;
                });

                if (matchedGame && matchedGame.score) {
                    finalScore = matchedGame.score; // 인터넷 백업본에 등록된 진짜 메타스코어 자동 매칭!
                }
            }

            // 최종 결과 주입 (둘 다 없으면 TBD)
            game.metacritic = finalScore || "TBD";
            return game;
        }));

        return res.status(200).json({ results: updatedGames });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
