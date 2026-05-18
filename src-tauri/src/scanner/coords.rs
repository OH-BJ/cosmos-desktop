// 3D 좌표 계산: Fractal Orbital Packing (M7-1 Step 1)
//
// # 알고리즘 개요
// Gemini Pro 7번째 교차검증에서 채택된 옵션 H. 디렉토리 트리를 그대로 우주 공간에
// 매핑하되, 각 부모 디렉토리가 자신만의 독립 구면(orbital sphere)을 형성한다.
//
// - **Fibonacci Sphere**: 자식들을 부모 주위 구면에 균등 분포. 황금비를 사용해
//   인접 자식 간 각도가 일정하게 멀어지는 시각적 패턴(해바라기 씨 배열)을 만든다.
// - **지수적 거리 축소**: 깊이가 깊어질수록 부모-자식 거리가 1/10 씩 줄어들어
//   자식 구면이 부모 구면 안에 자연스럽게 packing 된다.
// - **밀집도 보정**: 한 디렉토리에 자식이 많을수록 구 반경을 log10(N+1) 배로 늘려
//   서로 겹치지 않게.
//
// # BFS 호환성
// 큐 항목에 부모 좌표를 함께 들고 다니면 자식 좌표는 O(1) 로 계산된다. 별도의
// 후처리(force-directed iteration 등) 가 불필요해 스트리밍 청크 emit 과 함께
// 자연스럽게 동작한다.

/// Fibonacci Sphere 분포: i 번째 점의 단위 구면 좌표.
///
/// # 인자
/// - `i`: 0..total 사이의 인덱스
/// - `total`: 형제 노드 총 개수 (>= 1)
///
/// # 반환
/// 단위 구면(반경 1) 위의 한 점 (x, y, z). |v| ≈ 1.0.
///
/// # 황금비 활용
/// theta(방위각) 이 황금비 비율로 회전하면 인접 점들이 항상 가장 멀리 떨어진
/// 위치에 놓인다 (해바라기 패턴). phi(극각) 는 인덱스 비례로 균등 분포.
pub fn fibonacci_sphere(i: usize, total: usize) -> [f32; 3] {
    // total = 1 일 때 phi 의 분모가 1 이라 (i + 0.5) / 1 = 0.5 → acos(0) = π/2 (적도)
    // → 단위 벡터가 적도면 위 한 점. 안전하게 동작.
    debug_assert!(total >= 1, "total must be >= 1");
    debug_assert!(i < total, "i must be < total");

    // 황금비 φ = (1 + √5) / 2 ≈ 1.618
    let golden = (1.0 + 5.0_f32.sqrt()) / 2.0;
    // theta: i 마다 황금비 회전 (방위각)
    let theta = 2.0 * std::f32::consts::PI * (i as f32) / golden;
    // phi: 0~π 균등 분포 (극각). +0.5 로 양 극점 정확히 찍히는 것 회피.
    let phi = (1.0 - 2.0 * (i as f32 + 0.5) / total as f32).acos();
    let s = phi.sin();
    [s * theta.cos(), s * theta.sin(), phi.cos()]
}

/// 깊이별 부모-자식 거리(반경) 결정.
///
/// 수식: `r_d = 10^(6 - d)`, d ∈ [1, 6]. d = 0 (root) 은 절대 원점이라 반경 무의미 → 0.
/// d ≥ 7 은 r_d = 1 로 클램프 (지수가 음수가 되어 1.0 미만으로 떨어지지 않게).
///
/// 표:
/// - d=1 → 100,000  (10^5)
/// - d=2 → 10,000   (10^4)
/// - d=3 → 1,000    (10^3)
/// - d=4 → 100      (10^2)
/// - d=5 → 10       (10^1)
/// - d=6 → 1        (10^0)
pub fn radius_for_depth(depth: u32) -> f32 {
    if depth == 0 {
        return 0.0;
    }
    // (6 - depth) 가 음수가 되면 0 으로 클램프 → 10^0 = 1.0
    let exp = (6_i32 - depth as i32).max(0);
    10.0_f32.powi(exp)
}

/// 깊이별 인스턴스 스케일 (depth-aware instance scale).
///
/// # 배경 (D15 노션 카드)
/// 균일 BASE_RADIUS 가 Fractal Orbital Packing 의 계층적 거리(D1=100K → D5=10) 와
/// 충돌해 D3+ 노드들이 한 덩어리로 겹쳐 보이는 문제 해결. 각 깊이마다 부모-자식
/// 거리 비율(10×) 과 동일한 스케일을 부여하면 자식 노드들이 부모 안에 packing 되어도
/// 시각적으로 분리된다.
///
/// 표 (월드 단위 반지름):
/// - d=0 → 5000  (가상 root, 실제 BFS 에서는 생성 안 됨)
/// - d=1 → 500   (D1 별자리 — 부모 거리 100K 의 5/1000)
/// - d=2 → 50    (1/10 축소)
/// - d=3 → 5     (1/10 축소)
/// - d=4 → 0.5
/// - d>=5 → 0.05 (D5 이상 모두 동일 — 더 작아지면 4px 클램프에 흡수)
///
/// # 셰이더 / 4×4px 클램프와의 관계
/// 화면상 pixelDiameter = scale × P11 × H / depth (uBaseRadius=1 기준).
/// 멀어서 4px 미만이 되면 vertex shader 가 강제 4px 로 키워 별자리 윤곽 항상 가시화.
pub fn scale_for_depth(depth: u32) -> f32 {
    match depth {
        0 => 5000.0,
        1 => 500.0,
        2 => 50.0,
        3 => 5.0,
        4 => 0.5,
        _ => 0.05,
    }
}

/// 부모 위치 + sibling 인덱스 → 자식 위치.
///
/// # 인자
/// - `parent`: 부모 노드의 절대 좌표
/// - `depth`: 자식의 깊이 (root 직계 자식 = 1)
/// - `sibling_index`: 형제들 중 이 자식의 인덱스 (정렬 후 고정)
/// - `sibling_total`: 형제 총 개수
///
/// # 반환
/// 자식의 절대 좌표.
///
/// # 결정성
/// 같은 입력 → 같은 출력. 정렬된 인덱스를 입력하면 같은 트리는 항상 같은 별자리.
pub fn child_position(
    parent: [f32; 3],
    depth: u32,
    sibling_index: usize,
    sibling_total: usize,
) -> [f32; 3] {
    let r_d = radius_for_depth(depth);

    // 밀집도 보정: log10(N+1) → N=10 일 때 ~1.04, N=100 일 때 2.0, N=1000 일 때 3.0.
    // .max(1.0) 로 N=1 (log10(2) ≈ 0.3) 일 때 거리가 줄어드는 걸 방지.
    let log_factor = ((sibling_total as f32 + 1.0).log10()).max(1.0);
    let r_adjusted = r_d * log_factor;

    let local = fibonacci_sphere(sibling_index, sibling_total);
    [
        parent[0] + local[0] * r_adjusted,
        parent[1] + local[1] * r_adjusted,
        parent[2] + local[2] * r_adjusted,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// fibonacci_sphere 기본 케이스: total=1 일 때 단위 벡터 1개.
    #[test]
    fn fibonacci_single_point_is_unit() {
        let v = fibonacci_sphere(0, 1);
        let mag = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        assert!((mag - 1.0).abs() < 1e-5, "단위 벡터여야 함, got {}", mag);
    }

    /// fibonacci_sphere: 모든 점이 단위 구면 위에 있어야 함 (|v| = 1).
    #[test]
    fn fibonacci_all_points_on_unit_sphere() {
        let total = 50;
        for i in 0..total {
            let v = fibonacci_sphere(i, total);
            let mag = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
            assert!(
                (mag - 1.0).abs() < 1e-5,
                "i={}, |v| = {} 가 1.0 이 아님",
                i,
                mag
            );
        }
    }

    /// fibonacci_sphere: 두 점이 서로 다름 (분포 확인).
    #[test]
    fn fibonacci_points_are_distinct() {
        let v0 = fibonacci_sphere(0, 10);
        let v5 = fibonacci_sphere(5, 10);
        let dist = ((v0[0] - v5[0]).powi(2)
            + (v0[1] - v5[1]).powi(2)
            + (v0[2] - v5[2]).powi(2))
        .sqrt();
        assert!(dist > 0.5, "i=0 과 i=5 가 충분히 떨어져야 함, dist={}", dist);
    }

    /// radius_for_depth: 깊이별 정확한 값.
    #[test]
    fn radius_values_are_correct() {
        assert_eq!(radius_for_depth(0), 0.0, "root = 0");
        assert_eq!(radius_for_depth(1), 100_000.0, "d1 = 10^4 = 100,000");
        assert_eq!(radius_for_depth(2), 10_000.0, "d2 = 10^3");
        assert_eq!(radius_for_depth(3), 1_000.0, "d3 = 10^2");
        assert_eq!(radius_for_depth(4), 100.0, "d4 = 10^1");
        assert_eq!(radius_for_depth(5), 10.0, "d5 = 10^0");
        assert_eq!(radius_for_depth(6), 1.0, "d6 클램프 = 1.0");
        assert_eq!(radius_for_depth(100), 1.0, "d100 클램프 = 1.0");
    }

    /// child_position: 결정성 — 같은 입력은 같은 출력.
    #[test]
    fn child_position_is_deterministic() {
        let parent = [10.0, 20.0, 30.0];
        let a = child_position(parent, 2, 3, 7);
        let b = child_position(parent, 2, 3, 7);
        assert_eq!(a, b, "같은 입력 → 같은 출력");
    }

    /// child_position: 부모가 다르면 자식 좌표도 다름 (부모 격리).
    #[test]
    fn child_position_isolates_parents() {
        let p1 = [0.0, 0.0, 0.0];
        let p2 = [1000.0, 0.0, 0.0];
        let c1 = child_position(p1, 3, 0, 5);
        let c2 = child_position(p2, 3, 0, 5);
        // 부모가 1000 떨어져 있으면 자식들도 그만큼 떨어져야 한다.
        let dx = c1[0] - c2[0];
        assert!(
            dx.abs() > 900.0,
            "부모 격리 — c1.x - c2.x = {} (≈ -1000 기대)",
            dx
        );
    }

    /// child_position: 자식이 부모로부터 r_adjusted 만큼 떨어져 있는지.
    #[test]
    fn child_distance_matches_radius() {
        let parent = [0.0, 0.0, 0.0];
        let depth = 1;
        let total = 1;
        let child = child_position(parent, depth, 0, total);

        let dist = (child[0].powi(2) + child[1].powi(2) + child[2].powi(2)).sqrt();
        // depth=1, N=1: r_adjusted = 100,000 × log10(2).max(1.0) = 100,000 × 1.0
        let expected = 100_000.0;
        assert!(
            (dist - expected).abs() < 1.0,
            "child distance = {}, expected ≈ {}",
            dist,
            expected
        );
    }

    /// 밀집도 보정: N 이 클수록 자식 분산 거리가 커진다.
    #[test]
    fn density_compensation_scales_with_n() {
        let parent = [0.0, 0.0, 0.0];
        let small = child_position(parent, 3, 0, 1);
        let large = child_position(parent, 3, 0, 1000);

        let small_dist = (small[0].powi(2) + small[1].powi(2) + small[2].powi(2)).sqrt();
        let large_dist = (large[0].powi(2) + large[1].powi(2) + large[2].powi(2)).sqrt();
        // depth=3 → r_d=1000. small: 1000 × 1.0 = 1000. large: 1000 × log10(1001) ≈ 3000.
        assert!(
            large_dist > small_dist * 2.5,
            "N=1000 (dist={}) 이 N=1 (dist={}) 보다 적어도 2.5배 멀어야 함",
            large_dist,
            small_dist
        );
    }

    /// root 깊이 0: 반경 0 → 자식이 부모(원점)에 위치.
    /// 실제 BFS 에서는 root 자체를 노드로 생성하지 않지만, depth=0 입력 안전성 검증.
    #[test]
    fn depth_zero_keeps_at_origin() {
        let parent = [5.0, 5.0, 5.0];
        let child = child_position(parent, 0, 0, 1);
        // r_d = 0 → 자식 = 부모 위치
        assert_eq!(child, parent, "depth=0 은 부모 그대로");
    }

    /// scale_for_depth: D0~D5 정확한 값 + 큰 깊이 폴백.
    #[test]
    fn scale_for_depth_matches_spec() {
        assert_eq!(scale_for_depth(0), 5000.0, "d0 = 5000");
        assert_eq!(scale_for_depth(1), 500.0, "d1 = 500");
        assert_eq!(scale_for_depth(2), 50.0, "d2 = 50");
        assert_eq!(scale_for_depth(3), 5.0, "d3 = 5");
        assert_eq!(scale_for_depth(4), 0.5, "d4 = 0.5");
        assert_eq!(scale_for_depth(5), 0.05, "d5 = 0.05");
    }

    /// scale_for_depth: 큰 깊이는 D5 와 동일 값으로 클램프.
    #[test]
    fn scale_for_depth_clamps_to_d5_for_large_depths() {
        assert_eq!(scale_for_depth(6), 0.05, "d6 도 d5 와 동일");
        assert_eq!(scale_for_depth(10), 0.05, "d10 동일");
        assert_eq!(scale_for_depth(100), 0.05, "d100 동일");
    }

    /// scale_for_depth: 10× 비율 — 인접 깊이의 scale 이 정확히 10배 차이.
    #[test]
    fn scale_for_depth_has_decimal_ratio() {
        assert!((scale_for_depth(0) / scale_for_depth(1) - 10.0).abs() < 1e-3);
        assert!((scale_for_depth(1) / scale_for_depth(2) - 10.0).abs() < 1e-3);
        assert!((scale_for_depth(2) / scale_for_depth(3) - 10.0).abs() < 1e-3);
        assert!((scale_for_depth(3) / scale_for_depth(4) - 10.0).abs() < 1e-3);
        assert!((scale_for_depth(4) / scale_for_depth(5) - 10.0).abs() < 1e-3);
    }
}
