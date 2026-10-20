import type { RouteInfo } from './common/routes';

export function buildOpenApi(routes: RouteInfo[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const params = [...route.path.matchAll(/:(\w+)/g)].map((match) => match[1]!);
    const path = `/api${route.path.replace(/:(\w+)/g, '{$1}')}`;
    paths[path] ??= {};
    paths[path][route.method] = {
      tags: [route.tag],
      parameters: params.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      ...(route.public ? { security: [] } : {}),
      ...(route.permissions.length ? { description: `Requires: ${route.permissions.join(', ')}` } : {}),
      responses: { [route.method === 'post' ? '201' : '200']: { description: 'OK' } },
    };
  }
  return {
    openapi: '3.0.0',
    info: { title: 'Alliva API', description: 'Bahrain multi-merchant delivery platform', version: '1.0' },
    components: {
      securitySchemes: {
        cookie: { type: 'apiKey', in: 'cookie', name: 'alliva_access' },
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ cookie: [] }, { bearer: [] }],
    paths,
  };
}
