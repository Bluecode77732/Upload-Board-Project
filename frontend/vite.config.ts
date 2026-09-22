import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 브라우저가 localhost:5173 단일 출처로 보이도록 하는 개발용 프록시: /auth,/file,/user,/upload,/post,/comment로
// 오는 API 호출을 :3000의 백엔드로 전달한다. 이렇게 하면 CORS 없이도 리프레시 쿠키(SameSite=Strict, dev에서는
// Secure 미설정)가 정상 동작한다 — same-origin 요청은 쿠키를 그대로 실어 보낸다. 운영 환경도 같은 이유로
// same-origin이다 — 별도 CORS 설정이 아니라, 이 앱의 빌드가 API와 같은 ALB 뒤에서 같은 origin으로
// 서빙되기 때문이다(ADR 0060). dev의 프록시와 운영의 ALB 경로 분기는 서로 다른 메커니즘이지만 둘 다
// "브라우저 관점에서 하나의 origin"이라는 같은 결과를 낸다.
// '/post'와 '/file'은 일반 접두사가 아니라 정규식 문자열('^/post($|[/?])', '^/file($|[/?])')로 앵커링했다:
// Vite는 일반 문자열 키를 `url.startsWith(context)`로 매칭하는데, 그러면 클라이언트 라우트인 "/posts/:id"와
// "/files"(App.tsx)까지 백엔드 프록시로 삼켜버린다 — "/file/:id"가 이미 피하고 있는 것과 같은 종류의 충돌이다
// (실사용으로 확인됨: 단순 '/file' 접두사가 "/files"를 그대로 백엔드로 프록시해 SPA 라우터에 닿기도 전에
// 404가 났다). 문자 클래스가 그냥 `/`가 아니라 `[/?]`인 이유: "/file?take=20" 같은 단순 목록 쿼리는 "/file"
// 바로 뒤에 "/" 없이 "?"가 오므로, `($|/)` 앵커만으로는 이 경우를 놓친다(이것도 실사용으로 확인됨: 백엔드로
// 가지 않고 SPA의 index.html로 200과 함께 떨어져서, 프론트가 이를 JSON으로 파싱하지 못하고 실패했다).
// 앞으로 추가할 프록시 접두사의 텍스트가 클라이언트 라우트 이름의 접두사도 될 수 있다면 동일한 정규식 앵커
// 처리가 필요하다.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      '^/file($|[/?])': { target: 'http://localhost:3000', changeOrigin: true },
      '/user': { target: 'http://localhost:3000', changeOrigin: true },
      '/upload': { target: 'http://localhost:3000', changeOrigin: true },
      '^/post($|[/?])': { target: 'http://localhost:3000', changeOrigin: true },
      '/comment': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
