import { useEffect, useRef } from 'react';
import { DataSet, Network } from 'vis-network/standalone';
import type { Data, Edge as VisEdge, IdType, Node as VisNode, Options } from 'vis-network/standalone';

import { entityColor } from './entityGraph';
import type { GraphEdge, GraphEntity } from './entityGraph';

interface StoryGraphProps {
  entities: GraphEntity[];
  edges: GraphEdge[];
  onSelectEntity: (entityId: string) => void;
  focusEntityId?: string | null;
}

const NETWORK_OPTIONS: Options = {
  autoResize: true,
  nodes: {
    shape: 'dot',
    scaling: { min: 8, max: 40, label: { enabled: true, min: 12, max: 22 } },
    font: { color: '#e6e6e6', size: 14, face: 'inherit', strokeWidth: 3, strokeColor: '#1a1a1a' },
    borderWidth: 2,
  },
  edges: {
    color: { color: '#5a5a66', highlight: '#a5a9ff', hover: '#8a90ff', opacity: 0.85 },
    font: { color: '#b6b6b6', size: 11, strokeWidth: 3, strokeColor: '#1a1a1a', align: 'middle' },
    arrows: { to: { enabled: true, scaleFactor: 0.5 } },
    smooth: { enabled: true, type: 'dynamic', roundness: 0.5 },
    width: 1.5,
  },
  interaction: { hover: true, tooltipDelay: 150, navigationButtons: false, keyboard: false },
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: { gravitationalConstant: -45, springLength: 120, springConstant: 0.08 },
    stabilization: { enabled: true, iterations: 250, fit: true },
  },
};

function toVisNode(entity: GraphEntity): VisNode {
  const tooltip = [entity.name, entity.latestState].filter(Boolean).join(' — ');
  return {
    id: entity.entityId,
    label: entity.name,
    value: Math.max(entity.degree, 1),
    color: {
      background: entityColor(entity.entityType),
      border: entityColor(entity.entityType),
      highlight: { background: '#ffffff', border: entityColor(entity.entityType) },
      hover: { background: entityColor(entity.entityType), border: '#ffffff' },
    },
    title: tooltip || undefined,
  };
}

function toVisEdge(edge: GraphEdge): VisEdge {
  const ended = edge.untilChapter !== null;
  const tooltipParts = [edge.description, ended ? `ended Ch. ${edge.untilChapter}` : null].filter(Boolean);
  return {
    id: edge.relId,
    from: edge.sourceId,
    to: edge.targetId,
    label: edge.relType,
    dashes: ended,
    title: tooltipParts.length ? tooltipParts.join(' · ') : undefined,
    color: ended ? { color: '#4a4450', opacity: 0.6 } : undefined,
  };
}

/**
 * Thin, typed wrapper around vis-network. The Network instance is created once
 * and reused; only the backing DataSets are rebuilt when entities/edges change,
 * which lets vis animate incremental updates rather than tearing down the canvas.
 */
export default function StoryGraph({ entities, edges, onSelectEntity, focusEntityId }: StoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesRef = useRef<DataSet<VisNode> | null>(null);
  const edgesRef = useRef<DataSet<VisEdge> | null>(null);
  // Latest selection callback, read through a ref so the click handler bound
  // once at construction always sees the current prop without re-binding.
  const onSelectRef = useRef(onSelectEntity);

  useEffect(() => {
    onSelectRef.current = onSelectEntity;
  }, [onSelectEntity]);

  // Create the Network exactly once, on mount, and tear it down on unmount.
  useEffect(() => {
    if (!containerRef.current) return;
    const nodes = new DataSet<VisNode>([]);
    const edgeSet = new DataSet<VisEdge>([]);
    nodesRef.current = nodes;
    edgesRef.current = edgeSet;

    const data: Data = { nodes, edges: edgeSet };
    const network = new Network(containerRef.current, data, NETWORK_OPTIONS);
    networkRef.current = network;

    network.on('selectNode', (params?: { nodes?: IdType[] }) => {
      const nodeId = params?.nodes?.[0];
      if (nodeId !== undefined) onSelectRef.current(String(nodeId));
    });

    return () => {
      network.destroy();
      networkRef.current = null;
      nodesRef.current = null;
      edgesRef.current = null;
    };
  }, []);

  // Rebuild the DataSets whenever the graph data changes.
  useEffect(() => {
    const nodes = nodesRef.current;
    const edgeSet = edgesRef.current;
    if (!nodes || !edgeSet) return;
    nodes.clear();
    edgeSet.clear();
    nodes.add(entities.map(toVisNode));
    edgeSet.add(edges.map(toVisEdge));
  }, [entities, edges]);

  // Focus and select a node when the search box requests it.
  useEffect(() => {
    const network = networkRef.current;
    if (!network || !focusEntityId) return;
    if (!nodesRef.current?.get(focusEntityId)) return;
    network.selectNodes([focusEntityId]);
    network.focus(focusEntityId, { scale: 1.2, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
  }, [focusEntityId]);

  return <div ref={containerRef} className="story-graph-canvas" />;
}
