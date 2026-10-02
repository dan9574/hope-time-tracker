import React from 'react';
import * as d3 from 'd3';
import type { TimeBlock } from '../types';

interface Props {
  timeline: TimeBlock[];
  width: number;
  height: number;
  hoveredBlock: TimeBlock | null;
  onHover: (block: TimeBlock | null) => void;
  onSelect: (block: TimeBlock) => void;
  selectedId?: string | null;
}

const TimeArcChart: React.FC<Props> = ({
  timeline,
  width,
  height,
  onHover,
  hoveredBlock,
  onSelect,
  selectedId = null,
}) => {
  if (!timeline?.length) return null;

  const innerRadius = Math.max(0, width / 4);
  const outerRadius = Math.max(innerRadius + 1, width / 2 - 20);

  const first = timeline[0];
  const last = timeline[timeline.length - 1];

  const timeScale = d3
    .scaleTime()
    .domain([first.startTime, last.endTime])
    .range([-Math.PI / 2, Math.PI / 2]);

  // Arc generator is now very simple
  const arc = d3
    .arc<TimeBlock>()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius)
    .padAngle(0.01)
    .cornerRadius(5)
    .startAngle(d => timeScale(d.startTime) as number)
    .endAngle(d => timeScale(d.endTime) as number);

  const getBlockColor = (block: TimeBlock): string => {
    // Prefer a custom color provided by the backend (regardless of type)
    if (block.color) {
      return block.color;
    }
    // Otherwise use default colors
    const defaultColors: Record<string, string> = {
      logged: '#3b82f6',
      scheduled: '#a855f7',
      gap: '#faecf9ff',
    };
    return defaultColors[block.type] || '#cccccc';
  };

  return (
    <svg width={width} height={height}>
      <g transform={`translate(${width / 2}, ${height})`}>
        {timeline.map(block => {
          if (block.startTime.getTime() >= block.endTime.getTime()) {
            return null;
          }

          const isHovered = hoveredBlock?.id === block.id;
          const isSelected = selectedId === block.id;

          const baseStyle: React.CSSProperties = {
            cursor: 'pointer',
            transition: 'transform 0.2s ease-out, opacity 0.2s ease-out',
            transform: isHovered || isSelected ? 'scale(1.06)' : 'scale(1)',
            opacity: isSelected ? 1 : 0.95,
            filter: isSelected ? 'drop-shadow(0 2px 4px rgba(0,0,0,.25))' : 'none',
          };

          return (
            <path
              key={block.id}
              d={arc(block) || ''}
              fill={getBlockColor(block)}
              stroke={block.color ? getBlockColor(block) : 'rgba(0,0,0,0.05)'}
              strokeWidth={block.color ? 1 : 0.5}
              onMouseEnter={() => onHover(block)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(block)}
              style={baseStyle}
            />
          );
        })}
      </g>
    </svg>
  );
};

export default TimeArcChart;