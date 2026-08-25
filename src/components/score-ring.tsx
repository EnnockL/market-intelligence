export function ScoreRing({ score, risk = false }: { score: number; risk?: boolean }) {
  const color = risk && score >= 80 ? "var(--score-risk)" : score >= 80 ? "var(--score-high)" : score >= 60 ? "var(--score-mid)" : "var(--score-low)";
  return (
    <div className="score-ring" style={{ background: `conic-gradient(${color} ${score}%, var(--score-track) ${score}% 100%)` }}>
      <div className="score-ring__inner"><strong>{score}</strong><span>/100</span></div>
    </div>
  );
}

