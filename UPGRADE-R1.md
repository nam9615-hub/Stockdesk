# StockDesk R1.0 업그레이드 안내

## 이번 변경

- 오래된 스윙 5일/20일 성과가 채점되지 않던 대기열 기아 문제 수정
- 후보 `r1` 채점 후 `r5` 차트를 다시 가져오지 않던 구조적 누락 수정
- 개별 종목 데이터가 오래된 유니버스 사용 차단
- 스캐너 첫 페이지 장애를 전체 순회 완료로 오판하지 않도록 수정
- 검증 실패한 시장 방향 예측이 매수 판단에 쓰이지 않도록 차단
- AI와 독립된 ATR 기반 위험관리 엔진 R1.0 추가
- 종목별 권장 수량·손절률·목표수익률·최대보유기간 기록
- 크론 인증을 헤더/Bearer 방식으로 받을 수 있게 개선

## GitHub 업로드 경로

| 압축파일 안의 파일 | GitHub 경로 | 작업 |
|---|---|---|
| `api/cron.js` | `/api/cron.js` | 덮어쓰기 |
| `api/monitor.js` | `/api/monitor.js` | 덮어쓰기 |
| `src/App.jsx` | `/src/App.jsx` | 덮어쓰기 |
| `lib/risk.js` | `/lib/risk.js` | 새 파일 추가 |
| `test/risk.test.mjs` | `/test/risk.test.mjs` | 새 파일 추가 |
| `package.json` | `/package.json` | 덮어쓰기 |
| `package-lock.json` | `/package-lock.json` | 새 파일 추가 또는 덮어쓰기 |
| `UPGRADE-R1.md` | `/UPGRADE-R1.md` | 새 파일 추가 |

운영 중 더 최신 데이터가 있을 수 있으므로 압축파일의 `data` 폴더는 GitHub에 다시 올리지 않는다.

## Vercel 환경변수

- `PAPER_CAPITAL_KR=5000000`: 국내 모의계좌 원금(원)
- `PAPER_CAPITAL_US=5000`: 미국 모의계좌 원금(달러)
- `PAPER_RISK_PCT=0.5`: 거래당 허용 계좌손실률(%)
- `CRON_KEY`: 충분히 긴 무작위 비밀키
- `REQUIRE_CRON_AUTH=1`: 외부 스케줄러 인증 설정을 마친 뒤 활성화

외부 스케줄러에는 가능하면 URL의 `?key=` 대신 `X-Cron-Key: <CRON_KEY>` 헤더를 사용한다. `Authorization: Bearer <CRON_KEY>`도 지원한다.

## 배포 직후

1. 처음에는 `REQUIRE_CRON_AUTH`를 켜지 않고 배포한다.
2. `/api/cron?job=EVAL`을 여러 번 호출해 과거 채점을 복구한다.
3. 응답의 `queue.picks`, `queue.cands`가 감소하는지 확인한다.
4. 외부 스케줄러에 인증 헤더를 설정한다.
5. `REQUIRE_CRON_AUTH=1`을 설정하고 재배포한다.
6. 인증 없는 요청은 401, 인증 헤더 요청은 200인지 확인한다.

R1.0의 수량·손절·목표는 검증용 모의매매 계획이다. 아직 KIS 실계좌 주문에 직접 연결하지 않는다.
