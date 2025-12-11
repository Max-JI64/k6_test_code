import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

export const options = {
  // 계단식 부하 설정 (Step Load Pattern)
  stages: [
    // 1단계: 0 -> 50명 도달 (30초), 50명 유지 (1분)
    { duration: '30s', target: 50 },
    { duration: '1m', target: 50 },

    // 2단계: 50 -> 100명 도달 (30초), 100명 유지 (1분)
    { duration: '30s', target: 100 },
    { duration: '1m', target: 100 },

    // 3단계: 100 -> 150명 도달 (30초), 150명 유지 (1분)
    { duration: '30s', target: 150 },
    { duration: '1m', target: 150 },

    // 4단계: 150 -> 200명 도달 (30초), 200명 유지 (1분)
    { duration: '30s', target: 200 },
    { duration: '1m', target: 200 },

    // 5단계: 200 -> 250명 도달 (30초), 250명 유지 (1분)
    { duration: '30s', target: 250 },
    { duration: '1m', target: 250 },

    // 6단계: 250 -> 300명 도달 (30초), 300명 유지 (1분)
    { duration: '30s', target: 300 },
    { duration: '1m', target: 300 },

    // 종료: 0명으로 감소 (Cleanup)
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // 전체 요청의 95%가 500ms 미만이어야 함
    http_req_duration: ['p(95)<500'],
    // 에러율은 1% 미만이어야 함 (부하 테스트이므로 약간의 에러 허용)
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