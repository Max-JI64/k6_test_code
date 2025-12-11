import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

export const options = {
  // Capacity Test는 단계별로 올라가면서 "어디서 느려지는지" 관찰합니다.
  stages: [
    // 1단계: 50명 (충분히 김, 3분)
    { duration: '1m', target: 50 },  // 1분간 도달
    { duration: '3m', target: 50 },  // 3분간 유지 (이때 p95 확인)

    // 2단계: 100명
    { duration: '1m', target: 100 },
    { duration: '3m', target: 100 }, // 100명일 때 500ms 넘는지 확인

    // 3단계: 150명
    { duration: '1m', target: 150 },
    { duration: '3m', target: 150 }, // 150명일 때 500ms 넘는지 확인
    
    // ... 더 올릴 수 있음 ...

    { duration: '1m', target: 0 },   // 종료
  ],

  thresholds: {
    // [중요] 응답시간(p95)이 500ms를 넘으면 테스트 '실패'로 간주
    // abortOnFail: true로 설정하면 기준 초과 시 테스트를 즉시 중단시킬 수 있음
    http_req_duration: [{ threshold: 'p(95)<500', abortOnFail: false }], 
    
    // 에러율은 1% 미만이어야 함
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'https://api.goorm-ktb-010.goorm.team';

// [중요] 브라우저처럼 보이게 만드는 공통 헤더
const commonHeaders = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': BASE_URL, 
  'Referer': `${BASE_URL}/`
};

// 에러 로깅 헬퍼 함수
function logError(stepName, res) {
  if (res.status < 200 || res.status >= 300) {
    console.error(`❌ [${stepName} Error] Status: ${res.status} | URL: ${res.url}`);
    let bodyPreview = res.body;
    // HTML 응답이 올 경우를 대비해 태그 제거하고 출력하거나 앞부분만 출력
    if (bodyPreview && bodyPreview.length > 200) {
        bodyPreview = bodyPreview.substring(0, 200) + '...';
    }
    console.error(`   Body: ${bodyPreview}`);
  }
}

export default function () {
  let authHeaders = {};
  const userPassword = 'Password123!';
  const userEmail = `${randomString(10)}@loadtest.com`;

  // 1. 인증 흐름
  group('Auth Flow', function () {
    // A. 회원가입
    const registerPayload = JSON.stringify({
      name: `User_${randomString(5)}`,
      email: userEmail,
      password: userPassword,
    });

    const regRes = http.post(`${BASE_URL}/api/auth/register`, registerPayload, {
      headers: commonHeaders, // 공통 헤더 적용
    });

    if (!check(regRes, { 'Register status 201': (r) => r.status === 201 })) {
      logError('Register', regRes);
      return; 
    }

    // B. 로그인
    const loginPayload = JSON.stringify({
        email: userEmail,
        password: userPassword,
    });

    const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, {
        headers: commonHeaders, // 공통 헤더 적용
    });

    if (!check(loginRes, { 'Login status 200': (r) => r.status === 200 })) {
        logError('Login', loginRes);
        return;
    }

    // C. 토큰 추출
    const body = loginRes.json();
    const token = body.token || (body.data && body.data.token);
    const sessionId = body.sessionId || (body.data && body.data.sessionId);

    if (!token) {
        console.error(`🚨 Login Failed: Token is missing!`);
        return;
    }

    // 인증 헤더 생성 (기존 공통 헤더에 Authorization 추가)
    authHeaders = Object.assign({}, commonHeaders, {
      'Authorization': `Bearer ${token}`,
      'x-session-id': sessionId,
    });
  });

  if (!authHeaders['Authorization']) return;

  sleep(Math.random() * 2 + 1);

  // 2. 프로필 조회
  group('User Profile', function () {
    const res = http.get(`${BASE_URL}/api/users/profile`, { headers: authHeaders });
    if (!check(res, { 'Get Profile status 200': (r) => r.status === 200 })) {
      logError('User Profile', res);
    }
  });

  sleep(Math.random() * 2 + 1);

  // 3. 채팅방 목록 조회
  group('Room List', function () {
    const res = http.get(`${BASE_URL}/api/rooms?page=0&pageSize=10`, { headers: authHeaders });
    if (!check(res, { 'List Rooms status 200': (r) => r.status === 200 })) {
      logError('Room List', res);
    }
  });

  sleep(Math.random() * 2 + 1);

  // 4. 채팅방 생성
  if (Math.random() < 0.3) {
    group('Create Room', function () {
      const payload = JSON.stringify({ name: `LoadTest_Room_${randomString(5)}` });
      const res = http.post(`${BASE_URL}/api/rooms`, payload, { headers: authHeaders });
      if (!check(res, { 'Create Room status 201': (r) => r.status === 201 })) {
        logError('Create Room', res);
      }
    });
    sleep(1);
  }

  // 5. 회원 탈퇴
  group('Cleanup', function () {
    const res = http.del(`${BASE_URL}/api/users/account`, null, { headers: authHeaders });
    if (!check(res, { 'Delete Account status 200': (r) => r.status === 200 })) {
      logError('Cleanup', res);
    }
  });
}