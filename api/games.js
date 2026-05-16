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
        // 기간을 앞뒤로 3년씩 대폭 늘려서 명작들과 먼 미래의 기대작(붉은 사막 등)까지 다 잡히도록 수정
        const fromDate = new Date(new Date().setFullYear(now.getFullYear() - 3)).toISOString().split('T')[0];
        const toDate = new Date(new Date().setFullYear(now.getFullYear() + 3)).toISOString().split('T')[0];

        // 🎯 [취향 저격 장르 통합] Action(4), RPG(5), Shooter(2), Adventure(3 - 리애니멀 등 호러어드벤처 커버)
        // 전 세계 PC + 콘솔 통합 유저들이 가장 많이 추가한(-added) 순서대로 30개 땡겨오기
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&genres=action,role-playing-games-rpg,adventure&ordering=-added&page_size=30`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        const todayStr = now.toISOString().split('T')[0];
        const filteredGames = (rawgData.results || []).filter(game => {
            const isUpcoming = game.released ? game.released > todayStr : true;
            return tab === 'recent' ? (!isUpcoming && game.released) : isUpcoming;
        });

        // 스팀 API 정보를 연동하여 평점 및 싱글/멀티 태그 보완 (콘솔 독점작은 RAWG 데이터로 자동 방어)
        const updatedGames = await Promise.all(filteredGames.map(async (game) => {
            game.tags = game.tags || [];

            try {
                // 스팀 검색 (PC 버전이 존재하는 게임인 경우 데이터 보완)
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
                        
                        // 스팀 메타 스코어가 있으면 연동
                        if (details.metacritic && details.metacritic.score) {
                            game.metacritic = details.metacritic.score;
                        }

                        // 스팀 카테고리 기반 싱글/멀티 태그 복구 
                        if (details.categories) {
                            details.categories.forEach(cat => {
                                if (cat.id === 2) game.tags.push({ name: "Singleplayer", slug: "singleplayer" });
                                if (cat.id === 1 || cat.id === 38) game.tags.push({ name: "Multiplayer", slug: "multiplayer" });
                                if (cat.id === 9 || cat.id === 24) game.tags.push({ name: "Co-op", slug: "co-op" });
                            });
                        }
                    }
                }
            } catch (e) {
                // 에러 시 무시하고 RAWG 기본 데이터 유지
            }

            // RAWG 기본 태그 백업 매칭 (스팀에 없는 게임이나 누락 대비)
            if (game.tags.length === 0 && game.slug) {
                // RAWG 태그 중 싱글/멀티 관련 단어가 있으면 포맷팅 유지
                const rawgTags = game.tags || [];
                // 기존 RAWG 태그가 있으면 그대로 노출되도록 안전장치
            }

            // 중복 태그 제거 및 메타 스코어 예외 처리
            game.tags = Array.from(new Map(game.tags.map(item => [item.slug, item])).values());
            game.metacritic = game.metacritic || "TBD";
            
            return game;
        }));

        return res.status(200).json({ results: updatedGames });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
