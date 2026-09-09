// 목적: 파일 보드 화면 — 2단계 업로드 폼과 파일 보드를 담는다.
// 사용처: RequireAuth 하위 /files에 렌더링된다.
// 근거: 업로드 폼과 검색/정렬/페이지네이션 가능한 파일 보드(FileBoard)는 한 화면의 두 관심사다 —
//   업로드가 성공하면 refreshSignal을 올려 보드가 자신의 쿼리를 다시 실행한다.

import { useState } from 'react'
import { NavBar } from '../../shared/NavBar'
import { FileBoard } from './FileBoard'
import { UploadForm } from './UploadForm'
import styles from './DashboardPage.module.css'

export function DashboardPage() {
  // 값 자체에는 의미가 없다 — FileBoard는 이 값의 변화를 자신의 현재 쿼리를 다시 가져오라는
  // 신호로만 쓴다; 업로드 폼은 그 쿼리가 무엇인지 알지도 신경 쓰지도 않는다.
  const [refreshSignal, setRefreshSignal] = useState(0)

  return (
    <main className={styles.page}>
      <NavBar />
      <h1>Files</h1>
      <UploadForm onUploaded={() => setRefreshSignal((n) => n + 1)} />
      <FileBoard refreshSignal={refreshSignal} />
    </main>
  )
}
