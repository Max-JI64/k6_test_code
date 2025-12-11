# RestAPI 기반

## 사용량 부하테스트

사용자 시나리오 기반  
1. 회원가입 (새로운 유저 생성 및 토큰/세션 획득)

2. 프로필 조회 (인증 헤더 검증)

3. 채팅방 목록 조회 (조회 성능 테스트)

4. 채팅방 생성 (쓰기 작업 테스트)

5. 회원 탈퇴 (DB 데이터 누적 방지 및 정리)

### 1. `smoke_test.js`
서버 정상 구동 확인  

- 30초동안 1명
- 에러 절대 없어야함
- 서버 반응 500ms 이내


실행:  
```bash
k6 run --out web-dashboard smoke_test.js
```


### 2. `step_load_test.js`
- 1단계: 0 -> 50명 도달 (30초), 50명 유지 (1분)
- 2단계: 50 -> 100명 도달 (30초), 100명 유지 (1분)
- 3단계: 100 -> 150명 도달 (30초), 150명 유지 (1분)
- 4단계: 150 -> 200명 도달 (30초), 200명 유지 (1분)
- 5단계: 200 -> 250명 도달 (30초), 250명 유지 (1분)
- 6단계: 250 -> 300명 도달 (30초), 300명 유지 (1분)
- 에러율 5% 이내


실행 : 
```bash
k6 run --out web-dashboard step_load_test.js
```

### 3. `spike_test.js`
서버 단기간 폭주  
- 1. 예열 (Warm up): 정상적인 트래픽 - 50명 1분
- 2. 스파이크 (Spike): 30초 만에 10배 폭증 - 500명 30초
- 3. 진정 (Cooldown): 다시 정상화 및 회복 확인 - 50명 1분
- 에러율 5% 이내

실행 : 
```bash
k6 run --out web-dashboard spike_test.js
```

### 4. `capacity_test.js`
오류율을 최대로 버틸 수 있는 부하를 측정  
응답시간(p95)이 500ms를 넘으면 테스트 '실패'로 간주  

- 1단계: 1분안에 50명, 3분 유지
- 2단계: 1분안에 100명, 3분 유지
- 3단계: 1분안에 150명, 3분 유지
- **추가로 인원을 점진적으로 올려주세요**

실행 :  
```bash
k6 run --out web-dashboard smoke_test.js
```

## 시나리오 테스트
세가지의 시나리오가 동시에 작동하는지 확인  

1. chat_flow (채팅방 유저): 회원가입 → 채팅방 목록 조회 (가장 빈번한 작업)

2. room_maker (방장): 회원가입 → 새로운 채팅방 개설 (쓰기 작업)

3. profile_user (마이페이지 유저): 회원가입 → 프로필 조회 및 수정 (개인정보 작업)

### 5. `smoke_scenario_test.js`

실행 : 
```bash
k6 run --out web-dashboard smoke_scenario_test.js
```

### 6. `step_load_scenario_test.js`
세가지 시나리오 점진적 부하테스트  

```bash
k6 run --out web-dashboard step_load_scenario_test.js
```

### 7. `spike_scenario_test.js`
세가지 시나리오 스파이트 부하테스트  

```bash
k6 run --out web-dashboard spike_scenario_test.js
```

### 8. `capacity_scenario_test.js`
최대 유지시간 시나리오 테스트  
응답 시간이 500ms를 넘으면 "용량 초과"로 판단하고 테스트 중단  

실행 : 
```bash
k6 run --out web-dashboard capacity_scenario_test.js
```

## 단일 엔드포인트 테스트
한가지 api만 반복하여 요청

### 9. `auth_capacity_test.js`
회원가입, 로그인, 회원탈퇴 api를 반복하여 호출

- 1단계 : 30초안에 20명, 1분 유지
- 2단계 : 30초안에 50명, 2분 유지
- 3단계 : 30초안에 100명, 2분 유지
- 4단계 : 30초안에 150명, 2분 유지

실행 : 
```bash
k6 run --out web-dashboard auth_capacity_test.js
```

### 10 : `get_rooms_optimized.js`
한번 회원가입 후 채팅방 목록 조회 20회 반복  

- 1단계 : 30초안에 50명, 1분 유지
- 2단계 : 30초안에 100명, 1분 유지
- 3단계 : 30초안에 200명, 1분 유지


실행 : 
```bash
k6 run --out web-dashboard get_rooms_optimized.js
```

### 11. `create_room_optimized.js`
한번 회원가입 후 채팅방 생성 10회 반복  
**채팅방 삭제 로직이 없으므로 직접 DB삭제를 고려**  

- 1단계 : 30초안에 10명, 1분 유지
- 2단계 : 30초안에 30명, 1분 유지
- 3단계 : 30초안에 50명, 1분 유지

실행 : 
```bash
k6 run --out web-dashboard create_room_optimized.js
```

### 12. `noted_mix.js`
한번 회원가입 후 채팅방 생성과 목록 조회 5회 반복
**채팅방 삭제 로직이 없으므로 직접 DB삭제를 고려**  

- 1단계 : 30초안에 10명, 1분 유지
- 2단계 : 30초안에 30명, 1분 유지
- 3단계 : 30초안에 50명, 1분 유지


실행 : 
```bash
k6 run --out web-dashboard noted_mix.js
```

### 13. `get_profile_stress.js`
한번 회원가입 후 프로필 조회 20회 반복

- 1단계 : 30초안에 50명, 1분 유지
- 2단계 : 30초안에 100명, 1분 유지
- 3단계 : 30초안에 200명, 1분 유지
- 4단계 : 30초안에 300명, 1분 유지


실행 : 
```bash
k6 run --out web-dashboard get_profile_stress.js
```

### 14. `upload_file_test.js`
1mb이하 파일 업로드  

실행 : 
```bash
k6 run --out web-dashboard upload_file_test.js
```

### 15. `profile_update_test.js`
프로필 업데이트 테스트  

실행 : 
```bash
k6 run --out web-dashboard profile_update_test.js
```

# Socket.IO 기반

## `utils` 폴더
socket.io 부하테스트용 설정 파일 저장

### `config.js`
전역 환경 변수 및 설정 (URL, 디버그 모드 등)   

|속성|설명|역할|
|---|---|---|
|BASE_URL|Socket.IO 서버의 접속 주소 (URL)입니다. wss:// 프로토콜과 EIO=4&transport=websocket 파라미터가 포함됩니다.|모든 테스트 파일이 서버에 접속할 때 사용하는 단일 진입점을 제공하여 URL 변경 시 이 파일만 수정하면 됩니다.|
|TEST_ROOM_ID|테스트에 사용할 채팅방의 고정 ID입니다.|테스트 데이터의 일관성을 유지합니다.|
|DEBUG|디버그 모드 활성화 여부를 나타내는 Boolean 값입니다. (k6 run -e DEBUG=true로 제어 가능)|socket-io.js에서 이 값이 true일 때만 상세한 패킷 송수신 로그(디버그 로그)를 출력하도록 제어합니다.|


### `socket-io.js`
Socket.IO 프로토콜을 처리하는 핵심 공통 모듈 (K6 WebSocket 래퍼)

## `socket_tests` 폴더 
socket.io 부하테스트 시나리오 코드 저장

### `01_connection.js` 
첫 번째 시나리오: 동시 접속 및 연결 유지 테스트  

```bash
k6 run -e DEBUG=true socket_tests/01_connection.js

k6 run --out web-dashboard socket_tests/01_connection.js

K6_WEB_DASHBOARD=true k6 run socket_tests/01_connection.js
```

1. 접속 폭주 및 연결 유지 테스트 (Connection Storm & Soak Test)  
- 가장 기본적이면서도 중요한 테스트입니다. 짧은 시간 안에 대량의 유저가 몰릴 때 서버가 죽지 않고 연결을 유지하는지 확인합니다.
- 목표: 서버의 최대 동시 접속자 수(Concurrent Connections) 한계 확인 및 메모리 누수 탐지.

- 사용 이벤트: Connection (Handshake), joinRoom (채팅방 입장)

- 테스트 흐름:
- 1초에 N명씩 가상 유저(VU)가 웹소켓 연결을 시도합니다.
- 연결 성공 후 특정 채팅방(joinRoom)에 입장하고 아무런 행동 없이 대기합니다.
- 일정 시간(예: 30분) 동안 연결 끊김(Disconnection)이 발생하는지 모니터링합니다.

### `02_broadcast.js` 

```bash
k6 run -e DEBUG=true socket_tests/02_broadcast.js

k6 run --out web-dashboard socket_tests/02_broadcast.js

K6_WEB_DASHBOARD=true k6 run socket_tests/02_broadcast.js
```

2. 메시지 브로드캐스트 부하 테스트 (Fan-out / Broadcast Test)
- "유명인" 방이나 "공지사항" 방처럼, 한 명이 말하고 수천 명이 동시에 듣는 상황을 시뮬레이션합니다. 서버의 CPU 처리 능력을 가장 많이 소모하는 시나리오입니다.
- 목표: 메시지 수신 레이턴시(Latency) 측정 (보낸 시간 vs 받는 시간 차이).
- 사용 이벤트: 송신: chatMessage (Type: text), 수신: message (브로드캐스트 수신)
- 테스트 흐름:
- 1,000명의 VU가 하나의 방에 입장합니다.
- 단 1명의 VU가 1초 간격으로 메시지를 전송합니다.

### `03_many_to_many.js`

```bash
k6 run -e DEBUG=true socket_tests/03_many_to_many.js

k6 run --out web-dashboard socket_tests/03_many_to_many.js

K6_WEB_DASHBOARD=true k6 run socket_tests/03_many_to_many.js
```

3. 다대다 채팅 헤비 트래픽 테스트 (Many-to-Many Chatting)
- 일반적인 대형 단톡방 상황입니다. 다수의 사용자가 동시에 떠들 때 메시지 유실이 없는지 확인합니다.

- 목표: 메시지 처리량(Throughput) 검증 및 메시지 순서 보장 확인.
- 사용 이벤트: 송신: chatMessage, 수신: message
- 테스트 흐름:
- 100명의 VU가 하나의 방에 입장합니다.
- 모든 VU가 무작위 간격(예: 3~5초)으로 메시지를 전송합니다.
- 서버가 처리하는 초당 메시지 수와 에러율(MESSAGE_ERROR 등)을 측정합니다.

### `04_room_churn.js`

```bash
k6 run -e DEBUG=true socket_tests/04_room_churn.js

k6 run --out web-dashboard socket_tests/04_room_churn.js

K6_WEB_DASHBOARD=true k6 run socket_tests/04_room_churn.js
```

4. 채팅방 입장/퇴장 반복 테스트 (Room Churn Test)
- 사용자들이 방을 수시로 들락날락하는 상황입니다. Socket.IO의 join/leave 처리는 소켓 그룹 관리에 부하를 줍니다.
- 목표: 잦은 방 변경 시 세션 관리 안정성 및 룸 카운트 정확성 테스트.
- 사용 이벤트: joinRoom, leaveRoom, joinRoomSuccess (응답 확인)

- 테스트 흐름:
- VU가 연결 후 '방 A'에 joinRoom을 요청합니다.
- 입장 성공(joinRoomSuccess) 즉시 leaveRoom을 요청합니다.
- 잠시 후 '방 B'에 입장합니다. 이를 반복 수행하여 에러(ROOM_NOT_FOUND, JOIN_ROOM_ERROR) 발생 여부를 체크합니다.

### `05_history_fetching.js`

```bash
k6 run -e DEBUG=true socket_tests/05_history_fetching.js

k6 run --out web-dashboard socket_tests/05_history_fetching.js

K6_WEB_DASHBOARD=true k6 run socket_tests/05_history_fetching.js
```

5. 이전 메시지 조회 부하 테스트 (History Fetching)
- 채팅방에 들어오자마자 스크롤을 올려 과거 대화를 보는 상황입니다. 이는 실시간 소켓 서버뿐만 아니라 백엔드 DB(데이터베이스)의 I/O 성능을 집중적으로 테스트합니다.
- 목표: DB 조회 지연이 전체 소켓 서버의 블로킹(Blocking)을 유발하는지 확인.
- 사용 이벤트: fetchPreviousMessages, previousMessagesLoaded

- 테스트 흐름:
- 다수의 VU가 방에 입장합니다.
- 동시에 fetchPreviousMessages (limit: 30, before: timestamp) 이벤트를 발생시킵니다.
- previousMessagesLoaded 응답이 올 때까지의 시간을 측정합니다.

### `06_interaction_stress.js`

```bash
k6 run -e DEBUG=true socket_tests/06_interaction_stress.js

k6 run --out web-dashboard socket_tests/06_interaction_stress.js

K6_WEB_DASHBOARD=true k6 run socket_tests/06_interaction_stress.js
```

6. 인터랙션(읽음/리액션) 스트레스 테스트
- 메시지 전송 외에 자잘한 패킷(읽음 처리, 좋아요 등)이 쏟아지는 상황입니다.
- 목표: 작은 패킷들의 처리 속도 및 메시지 상태 동기화 성능 검증.
- 사용 이벤트: markMessagesAsRead, messageReaction (add/remove), messagesRead / messageReactionUpdate (브로드캐스트 수신)

- 테스트 흐름:
- 방에 이미 메시지가 쌓여 있다고 가정합니다.
- VU들이 무작위 메시지 ID에 대해 리액션(👍)을 보내거나 읽음 처리를 보냅니다.
- 다른 유저들에게 messageReactionUpdate가 즉각 반영되는지 확인합니다.

# 구조
## `socket.txt`
restapi의 구조에 대한 모든 설명 기입 -> 생성형ai에 입력함으로서 k6 테스트 코드 작성 가능

## `socket.txt`
socket.io의 구조에 대한 모든 설명 기입 -> 생성형ai에 입력함으로서 k6 테스트 코드 작성 가능
