import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';


export const options = {
  scenarios: {
    // 채팅 조회: 갑자기 500명까지 치솟음
    chat_viewer: {
      executor: 'ramping-vus',
      exec: 'chatFlow',
      stages: [
        { duration: '1m', target: 10 },   // 예열
        { duration: '10s', target: 500 }, // 💥 스파이크!
        { duration: '3m', target: 10 },   // 쿨다운
      ],
    },
    // 방 생성: 갑자기 50명까지 치솟음
    room_maker: {
      executor: 'ramping-vus',
      exec: 'createRoomFlow',
      stages: [
        { duration: '1m', target: 2 },
        { duration: '10s', target: 50 },  // 💥 스파이크!
        { duration: '3m', target: 2 },
      ],
    },
    // 프로필: 갑자기 100명까지 치솟음
    profile_manager: {
      executor: 'ramping-vus',
      exec: 'profileFlow',
      stages: [
        { duration: '1m', target: 5 },
        { duration: '10s', target: 100 }, // 💥 스파이크!
        { duration: '3m', target: 5 },
      ],
    },
  },
  thresholds: {
    // 스파이크 때는 에러율 기준을 조금 낮춰줌 (5%까지 허용)
    http_req_failed: ['rate<0.05'], 
  },
};


const BASE_URL = 'https://api.goorm-ktb-010.goorm.team';

// [수정됨] 403 에러 방지를 위한 공통 헤더 (브라우저 위장)
const commonHeaders = {
  'Content-Type': 'application/json',
  'User-Agent': 'k6-load-test-agent/1.0',
};

// --- [수정됨] 공통 헬퍼 함수: 회원가입 -> 로그인 -> 토큰 발급 ---
function getAuthHeaders() {
  const randomName = `SmokeUser_${randomString(5)}`;
  const email = `${randomString(8)}@smoke.test`;
  const password = 'Password123!';

  // 1. 회원가입
  const regRes = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({
    name: randomName,
    email: email,
    password: password
  }), { headers: commonHeaders });

  if (!check(regRes, { 'Register success': (r) => r.status === 201 })) {
    // 403 등 에러 발생 시 Body 앞부분만 잘라서 출력
    let bodyPreview = regRes.body ? regRes.body.toString().substring(0, 100) : '';
    console.error(`❌ [Register Failed] Status: ${regRes.status} | Body: ${bodyPreview}`);
    return null;
  }

  // 2. 로그인 (토큰 획득을 위해 필수)
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: email,
    password: password
  }), { headers: commonHeaders });

  if (!check(loginRes, { 'Login success': (r) => r.status === 200 })) {
    console.error(`❌ [Login Failed] Status: ${loginRes.status} | Body: ${loginRes.body}`);
    return null;
  }

  // 3. 토큰 추출
  const body = loginRes.json();
  const token = body.token || (body.data && body.data.token);
  const sessionId = body.sessionId || (body.data && body.data.sessionId);

  if (!token) {
    console.error(`🚨 Token missing! Body: ${loginRes.body}`);
    return null;
  }

  return {
    headers: Object.assign({}, commonHeaders, {
      'Authorization': `Bearer ${token}`,
      'x-session-id': sessionId,
    }),
    userId: body.user ? body.user._id : null
  };
}

// --- 시나리오 1: 채팅방 목록 조회 흐름 ---
export function chatFlow() {
  const auth = getAuthHeaders();
  if (!auth) return;

  // 채팅방 목록 조회
  const res = http.get(`${BASE_URL}/api/rooms?page=0&pageSize=10`, { headers: auth.headers });
  
  if (!check(res, { 'ChatFlow: Get Rooms 200': (r) => r.status === 200 })) {
    console.error(`❌ [ChatFlow Failed] Status: ${res.status}`);
  }

  // 회원 탈퇴 (데이터 정리)
  http.del(`${BASE_URL}/api/users/account`, null, { headers: auth.headers });
  
  sleep(Math.random() * 2 + 1);
}

// --- 시나리오 2: 채팅방 생성 흐름 ---
export function createRoomFlow() {
  const auth = getAuthHeaders();
  if (!auth) return;

  // 채팅방 생성
  const payload = JSON.stringify({ name: `SmokeRoom_${randomString(5)}` });
  const res = http.post(`${BASE_URL}/api/rooms`, payload, { headers: auth.headers });
  
  if (!check(res, { 'RoomMaker: Create Room 201': (r) => r.status === 201 })) {
    console.error(`❌ [RoomMaker Failed] Status: ${res.status}`);
  }

  // 회원 탈퇴
  http.del(`${BASE_URL}/api/users/account`, null, { headers: auth.headers });
  
  sleep(Math.random() * 2 + 2);
}

// --- 시나리오 3: 프로필 관리 흐름 ---
export function profileFlow() {
  const auth = getAuthHeaders();
  if (!auth) return;

  // 내 프로필 조회
  const res = http.get(`${BASE_URL}/api/users/profile`, { headers: auth.headers });
  
  if (!check(res, { 'ProfileMgr: Get Profile 200': (r) => r.status === 200 })) {
    console.error(`❌ [ProfileMgr Get Failed] Status: ${res.status}`);
  }

  // 내 프로필 수정
  const updatePayload = JSON.stringify({ name: `Updated_${randomString(5)}` });
  const updateRes = http.put(`${BASE_URL}/api/users/profile`, updatePayload, { headers: auth.headers });
  
  if (!check(updateRes, { 'ProfileMgr: Update Profile 200': (r) => r.status === 200 })) {
    console.error(`❌ [ProfileMgr Update Failed] Status: ${updateRes.status}`);
  }

  // 회원 탈퇴
  http.del(`${BASE_URL}/api/users/account`, null, { headers: auth.headers });
  
  sleep(Math.random() * 2 + 1);
}