// api/games.js
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    try {
        // 1. 스팀 공식 실시간 카테고리 피드 호출 (인기 신작 및 탑셀러 타겟팅)
        const steamListRes = await fetch('https://store.steampowered.com/api/featuredcategories/?l=korean&cc=KR');
        const steamListData = await steamListRes.json();
        
        // 인기 신작(new_releases)과 탑셀러(top_sellers) 목록을 합쳐서 중복 제거
        const newReleases = steamListData.new_releases?.items || [];
        const topSellers = steamListData.top_sellers?.items || [];
        const combinedGames = [...newReleases, ...topSellers];
        
        // 중복 AppID 제거 및 상위 12개 게임으로 압축 (타임아웃 방어)
        const uniqueIds = Array.from(new Set(combinedGames.map(g => g.id))).slice(0, 12);

        if (uniqueIds.length === 0) {
            return res.status(200).json({ results: [] });
        }

        // 2. 오직 스팀 API만을 이용해 상세 정보와 메타크리틱 점수 매칭하기
        const results = await Promise.all(uniqueIds.map(async (steamId) => {
            // 원본 스팀 아이템 정보 매칭
            const originItem = combinedGames.find(g => g.id === steamId);
            
            // 프론트엔드가 요구하는 데이터 규격(RAWG 포맷)으로 기본 템플릿 생성
            let gameObj = {
                id: steamId,
                name: originItem ? originItem.name : "Steam Game",
                slug: `steam-${steamId}`,
                released: "LIVE",
                background_image: originItem ? (originItem.large_capsule_image || originItem.header_image) : "",
                metacritic: null, // 스팀에서 직접 받아올 메타스코어 위치
                genres: [{ name: "PC Game" }]
            };

            try {
                // 스팀 공식 상점 상세 API 호출
                const detailRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${steamId}&l=korean`);
                const detailData = await detailRes.json();

                if (detailData[steamId]?.success) {
                    const appData = detailData[steamId].data;
                    
                    // 🎯 [핵심] 스팀이 보관하고 있는 메타크리틱 진짜 점수 추출!
                    if (appData.metacritic && appData.metacritic.score) {
                        gameObj.metacritic = appData.metacritic.score;
                    } else {
                        // 스팀 상점에 메타스코어가 안 적혀있을 때의 안전장치 (TBD 처리)
                        gameObj.metacritic = "TBD";
                    }

                    // 배경 이미지 업그레이드
                    if (appData.background) {
                        gameObj.background_image = appData.background;
                    }

                    // 장르 동기화
                    if (appData.genres) {
                        gameObj.genres = appData.genres.map(g => ({ name: g.description }));
                    }
                }
            } catch (err) {
                gameObj.metacritic = "TBD";
            }
            return gameObj;
        }));

        // 기존 프론트엔드 코드 수정 없이 그대로 붙도록 { results: [...] } 구조 반환
        return res.status(200).json({ results });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
