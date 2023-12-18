// eslint-disable-next-line no-restricted-imports
import { cloneDeep } from "lodash";
import { uuid } from "short-uuid";

import EventManager from "@calcom/core/EventManager";
import { sendScheduledSeatsEmails } from "@calcom/emails";
import {
  allowDisablingAttendeeConfirmationEmails,
  allowDisablingHostConfirmationEmails,
} from "@calcom/features/ee/workflows/lib/allowDisablingStandardEmails";
import { HttpError } from "@calcom/lib/http-error";
import { handlePayment } from "@calcom/lib/payment/handlePayment";
import prisma from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";

import type { IEventTypePaymentCredentialType } from "../../handleNewBooking";
import { refreshCredentials, findBookingQuery } from "../../handleNewBooking";
import type { SeatedBooking, NewSeatedBookingObject, HandleSeatsResultBooking } from "../types";

const createNewSeat = async (
  rescheduleSeatedBookingObject: NewSeatedBookingObject,
  seatedBooking: SeatedBooking
) => {
  const {
    tAttendees,
    attendeeLanguage,
    invitee,
    eventType,
    reqBookingUid,
    additionalNotes,
    noEmail,
    paymentAppData,
    allCredentials,
    organizerUser,
    fullName,
    bookerEmail,
  } = rescheduleSeatedBookingObject;
  let { evt } = rescheduleSeatedBookingObject;
  let resultBooking: HandleSeatsResultBooking;
  // Need to add translation for attendees to pass type checks. Since these values are never written to the db we can just use the new attendee language
  const bookingAttendees = seatedBooking.attendees.map((attendee) => {
    return { ...attendee, language: { translate: tAttendees, locale: attendeeLanguage ?? "en" } };
  });

  evt = { ...evt, attendees: [...bookingAttendees, invitee[0]] };

  if (eventType.seatsPerTimeSlot && eventType.seatsPerTimeSlot <= seatedBooking.attendees.length) {
    throw new HttpError({ statusCode: 409, message: "Booking seats are full" });
  }

  const videoCallReference = seatedBooking.references.find((reference) => reference.type.includes("_video"));

  if (videoCallReference) {
    evt.videoCallData = {
      type: videoCallReference.type,
      id: videoCallReference.meetingId,
      password: videoCallReference?.meetingPassword,
      url: videoCallReference.meetingUrl,
    };
  }

  const attendeeUniqueId = uuid();

  await prisma.booking.update({
    where: {
      uid: reqBookingUid,
    },
    include: {
      attendees: true,
    },
    data: {
      attendees: {
        create: {
          email: invitee[0].email,
          name: invitee[0].name,
          timeZone: invitee[0].timeZone,
          locale: invitee[0].language.locale,
          bookingSeat: {
            create: {
              referenceUid: attendeeUniqueId,
              data: {
                description: additionalNotes,
              },
              booking: {
                connect: {
                  id: seatedBooking.id,
                },
              },
            },
          },
        },
      },
      ...(seatedBooking.status === BookingStatus.CANCELLED && { status: BookingStatus.ACCEPTED }),
    },
  });

  evt.attendeeSeatId = attendeeUniqueId;

  const newSeat = seatedBooking.attendees.length !== 0;

  /**
   * Remember objects are passed into functions as references
   * so if you modify it in a inner function it will be modified in the outer function
   * deep cloning evt to avoid this
   */
  if (!evt?.uid) {
    evt.uid = seatedBooking?.uid ?? null;
  }
  const copyEvent = cloneDeep(evt);
  copyEvent.uid = seatedBooking.uid;
  if (noEmail !== true) {
    let isHostConfirmationEmailsDisabled = false;
    let isAttendeeConfirmationEmailDisabled = false;

    const workflows = eventType.workflows.map((workflow) => workflow.workflow);

    if (eventType.workflows) {
      isHostConfirmationEmailsDisabled =
        eventType.metadata?.disableStandardEmails?.confirmation?.host || false;
      isAttendeeConfirmationEmailDisabled =
        eventType.metadata?.disableStandardEmails?.confirmation?.attendee || false;

      if (isHostConfirmationEmailsDisabled) {
        isHostConfirmationEmailsDisabled = allowDisablingHostConfirmationEmails(workflows);
      }

      if (isAttendeeConfirmationEmailDisabled) {
        isAttendeeConfirmationEmailDisabled = allowDisablingAttendeeConfirmationEmails(workflows);
      }
    }
    await sendScheduledSeatsEmails(
      copyEvent,
      invitee[0],
      newSeat,
      !!eventType.seatsShowAttendees,
      isHostConfirmationEmailsDisabled,
      isAttendeeConfirmationEmailDisabled
    );
  }
  const credentials = await refreshCredentials(allCredentials);
  const eventManager = new EventManager({ ...organizerUser, credentials });
  await eventManager.updateCalendarAttendees(evt, seatedBooking);

  const foundBooking = await findBookingQuery(seatedBooking.id);

  if (!Number.isNaN(paymentAppData.price) && paymentAppData.price > 0 && !!seatedBooking) {
    const credentialPaymentAppCategories = await prisma.credential.findMany({
      where: {
        ...(paymentAppData.credentialId ? { id: paymentAppData.credentialId } : { userId: organizerUser.id }),
        app: {
          categories: {
            hasSome: ["payment"],
          },
        },
      },
      select: {
        key: true,
        appId: true,
        app: {
          select: {
            categories: true,
            dirName: true,
          },
        },
      },
    });

    const eventTypePaymentAppCredential = credentialPaymentAppCategories.find((credential) => {
      return credential.appId === paymentAppData.appId;
    });

    if (!eventTypePaymentAppCredential) {
      throw new HttpError({ statusCode: 400, message: "Missing payment credentials" });
    }
    if (!eventTypePaymentAppCredential?.appId) {
      throw new HttpError({ statusCode: 400, message: "Missing payment app id" });
    }

    const payment = await handlePayment(
      evt,
      eventType,
      eventTypePaymentAppCredential as IEventTypePaymentCredentialType,
      seatedBooking,
      fullName,
      bookerEmail
    );

    resultBooking = { ...foundBooking };
    resultBooking["message"] = "Payment required";
    resultBooking["paymentUid"] = payment?.uid;
    resultBooking["id"] = payment?.id;
  } else {
    resultBooking = { ...foundBooking };
  }

  resultBooking["seatReferenceUid"] = evt.attendeeSeatId;

  return resultBooking;
};

export default createNewSeat;
