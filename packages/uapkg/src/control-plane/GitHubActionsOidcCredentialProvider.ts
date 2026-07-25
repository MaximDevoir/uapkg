import { z } from 'zod';
import {
  ControlPlaneError,
  type RegistryTrust,
  UAPKG_CONTROL_PLANE_API,
  UAPKG_GITHUB_OIDC_AUDIENCE,
} from './ControlPlaneTypes.js';

const githubResponseSchema = z.object({ value: z.string().min(1) });
const exchangeResponseSchema = z.object({
  ok: z.literal(true),
  token: z.string().min(1),
  expiresAt: z.number().int().positive(),
});

export class GitHubActionsOidcCredentialProvider {
  public isAvailable(): boolean {
    return Boolean(
      process.env.GITHUB_ACTIONS === 'true' ||
        process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
        process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    );
  }

  public async exchange(trust: RegistryTrust): Promise<string> {
    if (trust.apiBaseUrl !== UAPKG_CONTROL_PLANE_API) {
      throw new Error(`UAPKG v1 OIDC exchange is pinned to ${UAPKG_CONTROL_PLANE_API}.`);
    }
    const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!this.isAvailable() || !requestUrl || !requestToken) {
      throw new Error(
        'GitHub Actions OIDC was selected but its identity-token endpoint is unavailable. The workflow must grant `id-token: write`.',
      );
    }

    const url = new URL(requestUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com')) {
      throw new Error('GitHub Actions supplied an unexpected OIDC token endpoint.');
    }
    url.searchParams.set('audience', UAPKG_GITHUB_OIDC_AUDIENCE);

    const githubResponse = await fetch(url, {
      headers: { authorization: `Bearer ${requestToken}` },
    });
    const githubValue = githubResponseSchema.safeParse(await safeJson(githubResponse));
    if (!githubResponse.ok || !githubValue.success) {
      throw new Error(`GitHub Actions did not issue an OIDC identity token (HTTP ${githubResponse.status}).`);
    }

    const exchangeResponse = await fetch(
      new URL('/v1/github-user-app/oidc/github-actions/exchange', trust.apiBaseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'github_actions',
          audience: UAPKG_GITHUB_OIDC_AUDIENCE,
          idToken: githubValue.data.value,
        }),
      },
    );
    const exchangeValue = await safeJson(exchangeResponse);
    if (!exchangeResponse.ok) {
      const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).safeParse(exchangeValue);
      if (error.success) {
        throw new ControlPlaneError(error.data.error.code, error.data.error.message, exchangeResponse.status);
      }
      throw new Error(`UAPKG rejected the GitHub Actions identity (HTTP ${exchangeResponse.status}).`);
    }
    const parsed = exchangeResponseSchema.safeParse(exchangeValue);
    if (!parsed.success) throw new Error('The UAPKG OIDC exchange response was invalid.');
    return parsed.data.token;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return {};
  }
}
