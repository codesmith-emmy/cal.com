import { z } from "zod";

import { _BookingModel as Booking } from "@calcom/prisma/zod";
import { extendedBookingCreateBody, iso8601 } from "@calcom/prisma/zod-utils";

import { schemaQueryUserId } from "./shared/queryUserId";

const schemaBookingBaseBodyParams = Booking.pick({
  uid: true,
  userId: true,
  eventTypeId: true,
  title: true,
  description: true,
  startTime: true,
  endTime: true,
  status: true,
}).partial();

export const schemaBookingCreateBodyParams = extendedBookingCreateBody.merge(schemaQueryUserId.partial());

const schemaBookingEditParams = z
  .object({
    title: z.string().optional(),
    startTime: iso8601.optional(),
    endTime: iso8601.optional(),
    // Not supporting responses in edit as that might require re-triggering emails
    // responses
  })
  .strict();

export const schemaBookingEditBodyParams = schemaBookingBaseBodyParams.merge(schemaBookingEditParams);
