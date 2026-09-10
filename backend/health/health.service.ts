// 목적: readiness 의존성 검사를 분리해 Nest를 부팅하지 않고도 단위 테스트할 수 있게 한다.
// 사용처: HealthController에서만 주입한다.
// 근거: 이 프로젝트의 커버리지는 서비스만 측정한다 — DB ping을 컨트롤러 밖에 두는 것이 그 분리 원칙을 따른다 (ADR 0031).

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly dataSource: DataSource) {}

  // 목적: DB가 실제로 쿼리에 응답하는지 확인한다.
  // 이유: 커넥션 풀이 열려 있어도 DB가 응답 불가 상태일 수 있어 단순 연결 여부 확인으로는 부족하다.
  // 방법: 가벼운 SELECT 1을 실행하고, 실패 시 상세 에러는 서버 로그에만 남긴 뒤 boolean으로 변환한다 — 내부 에러 detail은 응답으로 절대 나가지 않는다(Never Do G3).
  async checkDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error('Readiness check failed: database unreachable.', error);
      return false;
    }
  }
}
