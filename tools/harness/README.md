# 헤드리스 대전 하네스

봇 두 개를 Node에서 붙여 **1000세트를 7초에** 돌리고 승률을 재는 평가 도구.
브라우저·렌더링 없이 `src/`의 진짜 엔진을 그대로 구동한다.

**처음 받았다면 먼저 `./sync.sh`** — `engine/` 안의 엔진 파일들은 `src/` 에서
그대로 복사해 오는 것이라 저장소에 커밋하지 않는다(같은 코드가 두 벌이 되고
원본이 바뀌면 조용히 낡기 때문). 한 번 돌리면 체크섬과 함께 생성된다.

```sh
cd tools/harness && ./sync.sh          # 처음 한 번, 그리고 src/ 가 바뀔 때마다
node run.js --left MyBot_v2.js --right MyBot_v1.js --matches 400
node run.js --left MyBot_v1.js --right ai --matches 200
```

`--left`/`--right`는 `ai`(원작 내장 AI) 또는 `src/code-here/` 안의 파일명.
매 시드를 **좌우 바꿔 두 번** 돌린다(`--no-swap`으로 해제) — 이 포크는 코트가
완전 대칭이 아니라서(physics.js ADR-0031: 왼쪽 승률 42.6~46.3%) 한쪽으로만 재면
오른쪽 코트를 뽑은 봇이 유리해 보인다.

기타 옵션: `--seed N` `--no-touch-limit` `--time-limit 240`(본선 4분 룰)

## 왜 믿을 수 있나

**엔진을 다시 구현하지 않는다.** `./sync.sh`가 아래 7개를 `src/`에서 바이트 그대로
복사한다. 공 물리도, `expectedLandingPointX` 계산도, 내장 AI도, 라운드 상태머신도,
5회 접촉 룰도, 스냅샷 생성기도 전부 원본이다.

    physics.js  rand.js  cloud_and_wave.js  pikavolley.js
    rules/touchLimit.js  operator/console.js  bot/botContract.js

`engine/package.json`(`{"type":"module"}`)이 있어서 import 한 줄 고치지 않고 그대로
로드된다. **`src/`가 바뀌면 `./sync.sh`를 다시 돌릴 것** — 체크섬이 출력된다.

직접 작성한 것은 넷뿐이고, 각 파일 헤더에 근거가 적혀 있다:

| 파일 | 역할 |
|---|---|
| `engine/view.js` `audio.js` `keyboard.js` | 렌더러·사운드 no-op 스텁 |
| `botInput.js` | Worker 비동기 응답을 동기 호출 + 1프레임 지연으로 재현 |
| `match.js` | `syncWithGameState → gameLoop → observe` 프레임 루프 |
| `run.js` | CLI 집계 |

`engine/view.js`만 예외적으로 **진짜 cloud/wave 모델을 들고 있다.** 구름·파도가
물리와 같은 `rand()` 스트림을 쓰기 때문(생성자 40회 + 매 프레임 27회 이상)에,
빼먹으면 엔진이 브라우저와 다른 난수를 읽게 된다.

## 검증

```sh
node validate.js                      # ① 레포가 발표한 수치 재현
node compare.js browser-trace.json    # ② 브라우저와 프레임 단위 대조
```

**① ADR-0031 재현** — `physics.js` 주석에 이 포크의 실측치가 있다(내장 AI 대 내장 AI,
왼쪽 득점 42.6~46.3%, 랠리 607~641프레임). 하네스는 1800랠리×3그룹에서
왼쪽 42.1/46.4/45.4%, 랠리 629/632/625프레임 — 두 밴드 모두 재현.

**② 프레임 단위 대조** — 크롬에서 진짜 Worker 봇으로 돌린 1600프레임을 녹화해
대조한 결과, **프레임 71~1599의 29개 필드 44,341개 값이 전부 일치**(불일치 0).
공 좌표·속도·`expectedLandingPointX`·플레이어 state·충돌 플래그·스코어·서브권,
그리고 **엔진이 소비한 입력 3쌍**까지 일치하므로 3프레임 그룹 + 1프레임 지연
타이밍 모델도 정확하다. 프레임 0~70은 `expectedLandingPointX` 한 필드만 다른데,
그 구간은 물리가 안 도는 `startOfNewGame`이고 브라우저 인스턴스가 이전 경기의 값을
들고 있었기 때문이다(`Ball.initializeForNewRound()`는 이 필드를 리셋하지 않는다).

녹화 방법은 `compare.js` 헤더 참고. `collect.js`가 포트 8099에서 페이지의 POST를 받는다.

## 주의

- `decide()`를 Worker가 아니라 동기로 호출하므로 **실제 CPU 예산은 재지 않는다.**
  대신 `run.js`가 매 호출 시간을 재서 120ms 목표·360ms 하드 타임아웃 초과를 경고한다.
- 난수는 시드 고정(mulberry32)이라 같은 시드면 같은 경기가 재현된다.
