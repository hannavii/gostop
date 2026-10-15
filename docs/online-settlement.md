# 온라인 상세 정산의 데이터 흐름

점수와 정산의 source of truth는 기존 게임 엔진이다. 온라인 UI는 숫자를 재계산하지 않는다.

```
calculateScore → scoreItems
calculateSettlement / calculateGostopSettlement → 기존 정산값 + scoreItems + sakeCupAsPi
server applyAction(STOP) → Match.result → gameView → room:state
온라인 정산 컴포넌트 → 서버 값의 문자열·레이아웃 표시
```

## 추가 metadata

`ScoreResult.scoreItems`는 `{ id, label, points }[]`다. 기존 점수 함수가 실제로 더하는
광·열끗·고도리·띠·홍단·청단·초단·피의 기여분을 그 계산 지점에서 기록한다.
점수가 없는 항목은 포함하지 않는다. 술잔의 열끗/쌍피 선택도 기존 점수 비교 결과를 따른다.

두 settlement 결과에는 `scoreItems?`, `sakeCupAsPi?`만 추가했다. 기존 baseScore,
goBonus, 배수, 박, 최종값과 부담자는 변경하지 않았다. 타입의 추가 필드는 optional이므로
이전 fixture와 소비자가 여전히 유효하다. metadata가 없는 결과는 기존 합계만 표시하며
클라이언트가 획득패에서 누락된 세부 점수를 복원하지 않는다.

shared/online.ts는 기존 공통 settlement 타입을 참조하므로 별도 중복 타입이나 Socket 이벤트를
만들지 않았다. metadata는 STOP 정산 결과에만 실린다. 게임 진행 중 상대 손패는 추가 공개하지 않는다.

## 화면

- 맞고: 승자/패자, 최종 정산값, 기본 점수 항목, GO 추가 점수, 배수 적용 전 점수,
  적용된 배수·박, 엔진 값으로 구성한 정산식과 부담 방향을 표시한다.
- 고스톱: 승자와 총 획득, 기본 점수 항목, 승자 배수, 패자별 실제 payment,
  대납 전 normalPayment, 해당 패자의 totalMultiplier 및 적용된 박을 표시한다.
  goBakPayer/goBakPaidFor가 있는 경우 기존 대납 결과를 그대로 설명한다.
  고박을 별도의 새 ×2 항목으로 만들지 않는다.
- 획득패 버튼은 기존 CapturedCardsModal을 열며 플레이어별 서버 score를 전달한다.
  카드 분류만 수행하고 온라인 점수를 다시 계산하지 않는다.
- 기존 결과 모달의 세로 스크롤과 반응형 레이아웃을 사용한다. 재대결·나가기와
  ConnectionStatus 및 재접속 countdown을 유지한다.

## 복구와 호환성

세부 점수는 일시적인 React 상태가 아닌 Match.result에 저장된다. 종료 상태에서 F5나
재접속해도 같은 결과가 gameView를 통해 복구된다. 새 round의 보드 key는 기존대로
초기화되며 이전 정산이나 획득패 모달을 남기지 않는다.
싱글플레이 화면은 수정하지 않았다. 공통 엔진의 기존 숫자 계산과 반환 필드는 유지한다.

## 검증

`npm run test:online`은 기여분 합계, 실제 엔진 결과와 UI 일치, 적용 항목만 표시,
고박 대납, 공개 상태의 private hand 보호를 검증한다.
`npm run test:e2e`의 settlement 시나리오는 실제 STOP → 상세 정산 → 획득패 → F5 →
재대결을 2인/3인, 데스크톱/360/390px에서 실행하고 375/412px도 결과 모달과 획득패 모달을 검사한다.
