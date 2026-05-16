module.exports = async (req, res) => {
    const RAWG_KEY = process.env.RAWG_KEY;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (!RAWG_KEY) return res.status(500).json({ error: "RAWG_KEY missing" });

    try {
        const now = new Date();
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(now.getFullYear() - 2); // 🎯 타겟 범위를 최근 2년으로 넓혀서 명작 풀을 확보
        
        const fromDate = twoYearsAgo.toISOString().split('T')[0];
        const toDate = now.toISOString().split('T')[0];

        // 🎯 변경점 1: ordering=-added 로 변경 (최근 2년 출시작 중 전 세계 게이머들이 가장 많이 추가한 '체급 높은 대작' 순서로 정렬)
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&platforms=187,186,4&tags=story-rich,cinematic&ordering=-added&page_size=40`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        // 🎯 변경점 2: Added 컷트라인을 기존 300에서 3000으로 대폭 상향! (이하 급 인디/B급 게임 무조건 탈락)
        let aaaGames = (rawgData.results || []).filter(game => game.added && game.added >= 3000);

        // 혹시나 필터가 너무 세서 다 날아갔을 때를 대비한 안전장치 (최소 2000 이상)
        if (aaaGames.length < 5) {
            aaaGames = (rawgData.results || []).filter(game => game.added && game.added >= 2000);
        }

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
                        if (details.metacritic && details.metacritic.score) game.metacritic = details.metacritic.score;
                        if (details.categories) {
                            details.categories.forEach(cat => {
                                if (cat.id === 2) game.tags.push({ name: "Singleplayer", slug: "singleplayer" });
                                if (cat.id === 9 || cat.id === 24) game.tags.push({ name: "Co-op", slug: "co-op" });
                                if (cat.id === 1 || cat.id === 38) game.tags.push({ name: "Multiplayer", slug: "multiplayer" });
                            });
                        }
                    }
                }
            } catch (e) {}

            if (game.tags.length === 0) game.tags.push({ name: "Singleplayer", slug: "singleplayer" });
            game.tags = Array.from(new Map(game.tags.map(item => [item.slug, item])).values());
            game.metacritic = game.metacritic || "TBD";
            return game;
        }));

        return res.status(200).json({ results: updatedGames.slice(0, 30) });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
