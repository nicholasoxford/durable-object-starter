import { DurableObject } from 'cloudflare:workers';

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */
interface DomainOffer {
	email: string;
	amount: number;
	description?: string;
	timestamp: string;
}

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject {
	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async trackDomainRequest(domain: string) {
		// Get existing requests for this domain
		let requests = (await this.ctx.storage.get<number>(`domain:${domain}`)) || 0;
		requests++;

		// Store the updated count
		await this.ctx.storage.put(`domain:${domain}`, requests);

		return {
			domain,
			requests,
			timestamp: new Date().toISOString(),
		};
	}

	async getDomainRequests(domain: string) {
		return (await this.ctx.storage.get<number>(`domain:${domain}`)) || 0;
	}

	async submitDomainOffer(domain: string, offer: Omit<DomainOffer, 'timestamp'>) {
		// Get existing offers for this domain
		const offers = (await this.ctx.storage.get<DomainOffer[]>(`domain:${domain}`)) || [];

		const newOffer: DomainOffer = {
			...offer,
			timestamp: new Date().toISOString(),
		};

		offers.push(newOffer);

		// Store the updated offers
		await this.ctx.storage.put(`domain:${domain}`, offers);

		return {
			domain,
			offer: newOffer,
			totalOffers: offers.length,
		};
	}

	async getDomainOffers(domain: string) {
		return (await this.ctx.storage.get<DomainOffer[]>(`domain:${domain}`)) || [];
	}
}

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		// CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': 'https://agi-2025.com',
			'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type,Authorization',
			'Access-Control-Max-Age': '86400',
		};

		// Handle OPTIONS request for CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: corsHeaders,
			});
		}

		// Check for auth token in headers
		const authToken = request.headers.get('Authorization');
		if (!authToken || !authToken.startsWith('Bearer ') || authToken.split(' ')[1] !== env.AUTH_TOKEN) {
			return new Response('Unauthorized', {
				status: 401,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		const url = new URL(request.url);
		const domain = url.searchParams.get('domain');

		if (!domain) {
			return new Response('Domain parameter is required', { status: 400 });
		}

		let id = env.MY_DURABLE_OBJECT.idFromName(`domain-offers:${domain}`);
		let stub = env.MY_DURABLE_OBJECT.get(id);

		if (request.method === 'POST') {
			try {
				const { email, amount, description } = (await request.json()) as { email: string; amount: number; description: string };

				if (!email || !amount) {
					return new Response('Email and amount are required', {
						status: 400,
						headers: corsHeaders,
					});
				}

				const result = await stub.submitDomainOffer(domain, {
					email,
					amount,
					description,
				});

				return new Response(JSON.stringify(result), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			} catch (error) {
				return new Response('Invalid request body', {
					status: 400,
					headers: corsHeaders,
				});
			}
		} else {
			// Get all offers for the domain
			const offers = await stub.getDomainOffers(domain);
			return new Response(JSON.stringify({ domain, offers }), {
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}
	},
} satisfies ExportedHandler<Env>;
