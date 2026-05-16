module.exports = async (req, res) => {
    const RAWG_KEY = process.env.RAWG_KEY;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (!RAWG_KEY) return res.status(500).json({ error: "RAWG_KEY missing" });

    try {
        // 🎯 핵심 변경점: RAWG 메인의 'New and trending' 데이터를 긁어오는 전용 엔드포인트(/lists/main) 사용
        // platforms=4,187,186 (PC, PS5, Xbox Series X/S 대작 체급 고정)
        const rawgUrl = `https://api.rawg.io/api/games/lists/main?key=${RAWG_KEY}&ordering=-relevance&discover=true&platforms=4,187,186&page_size=30`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        const trendingGames = rawgData.results || [];

        const updatedGames = await Promise.all(trendingGames.map(async (game) => {
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

        return res.status(200).json({ results: updatedGames });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
