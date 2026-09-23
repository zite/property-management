import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getSettings, isStripeConfigured, rememberPortalUrl } from '@project/shared/server/settings';

/**
 * The portal's public face: branding, contact details and which features the
 * organization has switched on. Anyone can call it — nothing here is private.
 */
export default createEndpoint({
  description: 'Public branding, contact details and enabled portal features',
  inputSchema: z.object({}),
  outputSchema: z.object({
    settings: z.object({
      organizationName: z.string(),
      logoUrl: z.string().nullable(),
      brandColor: z.string(),
      phone: z.string(),
      emergencyPhone: z.string(),
      supportEmail: z.string().nullable(),
      websiteUrl: z.string().nullable(),
      address: z.string(),
      officeHours: z.string(),
      currency: z.string(),
      portalHeadline: z.string(),
      portalIntro: z.string(),
      paymentInstructions: z.string(),
      applicationFee: z.number(),
      incomeMultiple: z.number(),
    }),
    features: z.object({ onlinePayments: z.boolean(), stripeReady: z.boolean(), maintenanceRequests: z.boolean(), applications: z.boolean() }),
  }),
  execute: async () => {
    const settings = await rememberPortalUrl(await getSettings());
    return {
      settings: {
        organizationName: settings.organizationName,
        logoUrl: settings.logoUrl,
        brandColor: settings.brandColor,
        phone: settings.phone,
        emergencyPhone: settings.emergencyPhone,
        supportEmail: settings.supportEmail,
        websiteUrl: settings.websiteUrl,
        address: settings.address,
        officeHours: settings.officeHours,
        currency: settings.currency,
        portalHeadline: settings.portalHeadline,
        portalIntro: settings.portalIntro,
        paymentInstructions: settings.paymentInstructions,
        applicationFee: settings.applicationFee,
        incomeMultiple: settings.incomeMultiple,
      },
      features: {
        onlinePayments: settings.onlinePayments,
        // Card and bank payments need the organization's own Stripe account connected to this app.
        stripeReady: settings.onlinePayments && isStripeConfigured(),
        maintenanceRequests: settings.maintenanceRequests,
        applications: settings.applicationsOpen,
      },
    };
  },
});
