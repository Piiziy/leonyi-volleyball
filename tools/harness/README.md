# 헤드리스 대전 하네스

## 지금 어느 봇이 제출용인가

| 파일 | 내용 |
|---|---|
| **`src/code-here/Leonyi_v4.js`** | **제출용.** 팀명이 정해지면 이 파일 이름만 바꾼다 |
| `src/code-here/Leonyi_v1.js` | 회귀 비교 기준선 |
| `LabA_v1.js` `LabC_v1.js` | 전략 비교용 상대 (전탐색이 아닌 다른 설계) |

빌드: `node build.js B --as Leonyi_v4` (전략 B = 전탐색). `LabB_v1.js` 는 빌드
산출물이라 커밋하지 않는다.

※ 개발 중 만들었다가 되돌린 버전들이 있어 번호가 한 번 재사용됐다. 지금
남아 있는 v1/v3 가 위 표대로이고, 그 외 번호는 존재하지 않는다.


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

## 봇을 고쳤을 때의 표준 절차

승률만 보면 안 된다. **"나빠졌다"는 알려주지만 "왜"는 못 알려준다.** 순서대로:

```sh
node behavior.js --left 후보.js --right 기준선.js --matches 8   # 행동 결함
node bench.js    --bot 후보.js --matches 6                      # 기준 상대들에게 안 깨졌나
node run.js --left 후보.js --right 기준선.js --matches 30       # 최종 승률
```

`behavior.js` 는 승률에 안 나타나는 것들을 센다 — 서서 받을 공을 점프로 놓친
횟수, 공에 안 닿은 헛점프 비율, 자책, 터치리밋. 이게 실제 버그를 잡는다.

**측정 전에 대조 실험부터:**

```sh
node handicap.js --a X.js --b X.js --aBudget 6000 --bBudget 6000 --matches 20
```

같은 파일끼리 붙이면 **정확히 50%** 가 나와야 한다. 안 나오면 도구가 고장 난
것이고 그 상태의 측정은 전부 무의미하다. 실제로 이걸로 하네스의 비결정론
버그를 잡았다(EXPERIMENTS.md 참고).

**측정 중에 봇 파일을 다시 빌드하지 말 것.** 병렬 일꾼(`worker.js`)은 매 매치마다
`src/code-here/` 에서 파일을 다시 읽는다. 측정이 도는 동안 `build.js` 를 돌리면
중간부터 다른 봇을 재게 되고, 그 사실이 결과 어디에도 드러나지 않는다.

**반드시 지킬 것 두 가지:**

1. **좌우를 바꿔가며 잴 것.** 이 포크는 코트가 완전 대칭이 아니라, 한쪽만 재면
   진영 편향이 개선으로 둔갑한다. 실제로 "득점 80:43 개선" 으로 보였던 것이
   좌우 스왑 후 100:95(무차이)로 드러난 적이 있다. 세 도구 모두 스왑한다.
2. **약한 상대로 판단하지 말 것.** 내장 AI·가이드 예제·LabA 상대로는 변별이
   안 된다. 승률이 크게 나빠진 버전도 그들 상대로는 오히려 좋아 보였다.
   **자기 대전(또는 직전 버전과의 대전)만이 시험대다.**

빠르게 반복하려면 `--tune '{"NODE_BUDGET":1000}'` 으로 양쪽 예산을 함께 낮춘다.
단 큰 효과만 신뢰할 것 — 예산에 따라 결과가 달라지는 변경도 있다.

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
