import { Color, defineFunction, Dimension, List, Node, Paren, Quoted, Sequence, Url } from '@jesscss/core';

type GradientStop = { color: Color; position?: Dimension };

function flattenSingle(node: Node): Node {
  while (node instanceof Paren) {
    node = node.value!;
  }
  while ((node instanceof Sequence || node instanceof List) && node.value.length === 1) {
    node = node.value[0]!;
    while (node instanceof Paren) {
      node = node.value!;
    }
  }
  return node;
}

function maybeGradientStop(node: Node): GradientStop | undefined {
  node = flattenSingle(node);
  if (node instanceof Color) {
    return { color: node };
  }
  if ((node instanceof Sequence || node instanceof List) && node.value.length === 2) {
    const first = flattenSingle(node.value[0]!);
    const second = flattenSingle(node.value[1]!);
    if (first instanceof Color && second instanceof Dimension) {
      return { color: first, position: second };
    }
  }
  return undefined;
}

function collectStops(nodes: Node[], out: GradientStop[]): void {
  for (let node of nodes) {
    node = flattenSingle(node);
    const stop = maybeGradientStop(node);
    if (stop) {
      out.push(stop);
      continue;
    }
    if (node instanceof Sequence || node instanceof List) {
      collectStops(node.value, out);
      continue;
    }
    throw new Error('svg-gradient expects direction, start_color [start_position], [color position,]..., end_color [end_position] or direction, color list');
  }
}

function colorToHex(color: Color): string {
  const [r, g, b] = color.rgb;
  return '#' + [r, g, b]
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('');
}

const DIRECTION_TO_SVG = new Map<string, { type: 'linear' | 'radial'; direction: string; rect: string }>([
  ['to bottom', {
    type: 'linear',
    direction: 'x1="0%" y1="0%" x2="0%" y2="100%"',
    rect: 'x="0" y="0" width="1" height="1"'
  }],
  ['to right', {
    type: 'linear',
    direction: 'x1="0%" y1="0%" x2="100%" y2="0%"',
    rect: 'x="0" y="0" width="1" height="1"'
  }],
  ['to bottom right', {
    type: 'linear',
    direction: 'x1="0%" y1="0%" x2="100%" y2="100%"',
    rect: 'x="0" y="0" width="1" height="1"'
  }],
  ['to top right', {
    type: 'linear',
    direction: 'x1="0%" y1="100%" x2="100%" y2="0%"',
    rect: 'x="0" y="0" width="1" height="1"'
  }],
  ['ellipse', {
    type: 'radial',
    direction: 'cx="50%" cy="50%" r="75%"',
    rect: 'x="-50" y="-50" width="101" height="101"'
  }],
  ['ellipse at center', {
    type: 'radial',
    direction: 'cx="50%" cy="50%" r="75%"',
    rect: 'x="-50" y="-50" width="101" height="101"'
  }]
]);

const svgGradient = defineFunction(
  'svg-gradient',
  async function(this: any, direction: Node, ...rest: Node[]) {
    const normalizeNode = async (node: Node): Promise<Node> => {
      let normalized = await node.eval(this.context);
      while (normalized instanceof Paren) {
        normalized = await normalized.value!.eval(this.context);
      }
      if (normalized instanceof Sequence || normalized instanceof List) {
        const items = await Promise.all((normalized.value ?? []).map(item => normalizeNode(item)));
        if (normalized instanceof Sequence) {
          return new Sequence(items, normalized.options, normalized.location, normalized.treeContext).inherit(normalized);
        }
        return new List(items, normalized.options, normalized.location, normalized.treeContext).inherit(normalized);
      }
      return normalized;
    };

    direction = await normalizeNode(direction);
    rest = await Promise.all(rest.map(stop => normalizeNode(stop)));

    const directionValue = direction.toString().trim();
    const svgDirection = DIRECTION_TO_SVG.get(directionValue);
    if (!svgDirection) {
      throw new Error('svg-gradient direction must be \'to bottom\', \'to right\', \'to bottom right\', \'to top right\' or \'ellipse at center\'');
    }

    const stops: GradientStop[] = [];
    collectStops(rest, stops);
    if (stops.length < 2) {
      throw new Error('svg-gradient expects direction, start_color [start_position], [color position,]..., end_color [end_position] or direction, color list');
    }

    let markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><${svgDirection.type}Gradient id="g" ${svgDirection.direction}>`;
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]!;
      const position = stop.position
        ? stop.position.toString().trim()
        : i === 0
          ? '0%'
          : '100%';
      const opacity = stop.color.alpha < 1 ? ` stop-opacity="${stop.color.alpha}"` : '';
      markup += `<stop offset="${position}" stop-color="${colorToHex(stop.color)}"${opacity}/>`;
    }
    markup += `</${svgDirection.type}Gradient><rect ${svgDirection.rect} fill="url(#g)" /></svg>`;

    const uri = `data:image/svg+xml,${encodeURIComponent(markup)}`;
    return new Url(new Quoted(uri, { quote: '\'' }));
  },
  {
    params: [{
      name: 'direction',
      type: Node
    }, {
      name: 'stops',
      type: Node,
      rest: true
    }]
  }
);

export default svgGradient;
