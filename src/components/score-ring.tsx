export function ScoreRing({ score, risk = false }: { score: number; risk?: boolean }) {
  const color = risk && score >= 80 ? "#ff5c69" : score >= 80 ? "#6ef2b4" : score >= 60 ? "#f7c96b" : "#9aa5b5";
  return (
    <div className="score-ring" style={{ background: `conic-gradient(${color} ${score}%, #202935 ${score}% 100%)` }}>
      <div className="score-ring__inner"><strong>{score}</strong><span>/100</span></div>
    </div>
  );
}

