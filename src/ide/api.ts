import type { Project } from '../shared/project'
import { validateProject } from '../shared/projectSchema'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const projectUrl = (id: string): string => `/p/${id}`

async function request(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchFn(url, init)
  } catch {
    throw new ApiError("We couldn't reach the server. Are you online?", 0)
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    const message =
      typeof (body as { error?: unknown })?.error === 'string'
        ? (body as { error: string }).error
        : 'Something went wrong saving your game.'
    throw new ApiError(message, response.status)
  }
  return body
}

const jsonInit = (method: string, project: Project): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(project),
})

export async function createProject(
  project: Project,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const body = await request('/api/projects', jsonInit('POST', project), fetchFn)
  const id = (body as { id?: unknown })?.id
  if (typeof id !== 'string') throw new ApiError('The server did not return a game link.', 0)
  return id
}

export async function loadProject(id: string, fetchFn: typeof fetch = fetch): Promise<Project> {
  const body = await request(`/api/projects/${id}`, { method: 'GET' }, fetchFn)
  const result = validateProject(body)
  if (!result.ok) throw new ApiError(result.error, 0)
  return result.project
}

export async function saveProject(
  id: string,
  project: Project,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await request(`/api/projects/${id}`, jsonInit('PUT', project), fetchFn)
}
