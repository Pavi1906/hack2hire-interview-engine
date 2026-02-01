import React from 'react';
import { Difficulty } from '../types';

export const DifficultyBadge: React.FC<{ difficulty: Difficulty }> = ({ difficulty }) => {
  const colors = {
    [Difficulty.Easy]: 'bg-green-900 text-green-300 border-green-700',
    [Difficulty.Medium]: 'bg-yellow-900 text-yellow-300 border-yellow-700',
    [Difficulty.Hard]: 'bg-red-900 text-red-300 border-red-700',
  };

  return (
    <span className={`px-2 py-1 rounded border text-xs font-bold uppercase ${colors[difficulty]}`}>
      {difficulty}
    </span>
  );
};

export const ScoreBadge: React.FC<{ score: number }> = ({ score }) => {
  let color = 'text-green-400';
  if (score < 4) color = 'text-red-400';
  else if (score < 7) color = 'text-yellow-400';

  return <span className={`font-mono font-bold ${color}`}>{score.toFixed(1)}</span>;
};