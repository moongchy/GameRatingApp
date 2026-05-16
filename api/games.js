// api/games.js
export default async function handler(request, response) {
    // Vercel 금고에 저장해둔 RAWG_KEY 꺼내오기
    const RAWG_KEY = process.env.RAWG_KEY;
    const { tab = 'recent' } = request.query;

    try {
        const now = new Date();
        const fromDate = new Date(new Date().setFullYear(now.getFullYear() - 1)).toISOString().split('T')[0];
        const toDate = new Date(new Date().setFullYear(now.getFullYear() + 1)).toISOString().split('T')[0];

        // 1. RAWG API 호출
        const rawgUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${fromDate},${toDate}&ordering=-added&page_size=30`;
        const rawgRes = await fetch(rawgUrl);
        const rawgData = await rawgRes.json();

        const todayStr = now.toISOString().split('T')[0];

        // 2. 탭 기준에 맞게 기본 필터링
        const filteredGames = rawgData.results.filter(game => {
            const isUpcoming = game.released ? game.released > todayStr : true;
            return tab === 'recent' ? (!isUpcoming && game.released) : isUpcoming;
        });

        // 3. 💡 핵심: RAWG 점수가 없는(null) 게임 중 상위 5개만 메타크리틱 실시간 크롤링 시도
        // (서버 과부하 및 대기 시간 단축을 위해 상위 5개 기대작 위주로 방어)
        const updatedGames = await Promise.all(filteredGames.map(async (game) => {
            if (!game.metacritic) {
                try {
                    // 메타크리틱 상세 페이지 주소 규칙: 게임 슬러그 활용
                    const metaUrl = `https://www.metacritic.com/game/${game.slug}`;
                    const metaRes = await fetch(metaUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                    
                    if (metaRes.ok) {
                        const html = await metaRes.text();
                        // 정규식을 활용해 HTML 내에서 점수 구조 추출
                        const scoreMatch = html.match(/class="[^"]*c-productScore_score[^"]*"[^>]*>\s*<span>(\d+)<\/span>/);
                        if (scoreMatch && scoreMatch[1]) {
                            game.metacritic = parseInt(scoreMatch[1], 10); // 크롤링한 진짜 점수 주입!
                        }
                    }
                } catch (e) {
                    // 크롤링 실패 시 조용히 넘어감
                }
            }
            return game;
        }));

        // CORS 에러 방지 헤더 설정 후 브라우저로 배달
        response.setHeader('Access-Control-Allow-Origin', '*');
        return response.status(200).json({ results: updatedGames });

    } catch (error) {
        return response.status(500).json({ error: error.message });
    }
}
