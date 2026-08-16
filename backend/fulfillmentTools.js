const { isExplicitConfirmation } = require("./confirmationTools");

const setPickupDetailsTool = {
  name: "set_pickup_details",
  description:
    "Select pickup as the order's fulfillment method and record the customer's name (required) and an estimated pickup time (optional). Only call this once you have the customer's name — ask for it first if you don't have it yet. Ask only for information that's still missing; don't re-ask for details already provided.",
  input_schema: {
    type: "object",
    properties: {
      customerName: {
        type: "string",
        description: "The customer's name for the pickup order.",
      },
      pickupTime: {
        type: "string",
        description:
          "Optional estimated pickup time, in the customer's own words (e.g. \"in 15 minutes\", \"5:30 PM\").",
      },
    },
    required: ["customerName"],
  },
};

function executeSetPickupDetails(order, input) {
  const { customerName, pickupTime } = input || {};

  if (typeof customerName !== "string" || !customerName.trim()) {
    return {
      isError: true,
      content: "customerName is required. Ask the customer for their name before calling this tool.",
    };
  }

  order.orderType = "pickup";
  order.customer.name = customerName.trim();
  order.customer.pickupTime = typeof pickupTime === "string" && pickupTime.trim() ? pickupTime.trim() : null;

  const timeSummary = order.customer.pickupTime ? `, estimated pickup time: ${order.customer.pickupTime}` : "";
  return {
    isError: false,
    content: `Order set to pickup under the name "${order.customer.name}"${timeSummary}.`,
  };
}

const setDeliveryDetailsTool = {
  name: "set_delivery_details",
  description:
    "Select delivery as the order's fulfillment method and record the customer's name, phone number, and full delivery address (all required), plus an apartment/unit number and delivery instructions if the customer has them (both optional). Only call this once you have every required field — ask the customer for whatever is still missing first. Never guess, assume, or auto-fill any of these details.",
  input_schema: {
    type: "object",
    properties: {
      customerName: {
        type: "string",
        description: "The customer's name for the delivery order.",
      },
      phone: {
        type: "string",
        description: "The customer's phone number.",
      },
      address: {
        type: "string",
        description: "The full delivery street address, exactly as given by the customer.",
      },
      apartment: {
        type: "string",
        description: "Apartment or unit number, if applicable. Omit if the customer doesn't have one.",
      },
      deliveryInstructions: {
        type: "string",
        description: "Delivery instructions, if any (e.g. gate code, leave at door). Omit if the customer gives none.",
      },
    },
    required: ["customerName", "phone", "address"],
  },
};

function executeSetDeliveryDetails(order, input) {
  const { customerName, phone, address, apartment, deliveryInstructions } = input || {};

  const missing = [];
  if (typeof customerName !== "string" || !customerName.trim()) missing.push("customerName");
  if (typeof phone !== "string" || !phone.trim()) missing.push("phone");
  if (typeof address !== "string" || !address.trim()) missing.push("address");

  if (missing.length) {
    return {
      isError: true,
      content: `Missing required delivery details: ${missing.join(", ")}. Ask the customer for these — never guess or assume them.`,
    };
  }

  order.orderType = "delivery";
  order.customer.name = customerName.trim();
  order.customer.phone = phone.trim();
  order.customer.address = address.trim();
  order.customer.apartment = typeof apartment === "string" && apartment.trim() ? apartment.trim() : null;
  order.customer.deliveryInstructions =
    typeof deliveryInstructions === "string" && deliveryInstructions.trim() ? deliveryInstructions.trim() : null;
  order.customer.addressConfirmed = false;

  const parts = [
    `name: ${order.customer.name}`,
    `phone: ${order.customer.phone}`,
    `address: ${order.customer.address}`,
  ];
  if (order.customer.apartment) parts.push(`apartment/unit: ${order.customer.apartment}`);
  if (order.customer.deliveryInstructions) parts.push(`instructions: ${order.customer.deliveryInstructions}`);

  return {
    isError: false,
    content: `Order set to delivery — ${parts.join(
      "; "
    )}. Before checkout, read the full address back to the customer and call confirm_delivery_address once they explicitly confirm it (or update it with this tool if they correct it).`,
  };
}

const confirmDeliveryAddressTool = {
  name: "confirm_delivery_address",
  description:
    "Mark the customer's delivery address as explicitly confirmed. Only call this after you have read the full delivery address back to the customer and they clearly confirmed it (e.g. \"yes\", \"that's correct\") — never call it on an ambiguous reply, and never assume confirmation. Pass the customer's exact reply as customerReply — it is validated in code, and anything that isn't a clear confirmation will be rejected. If the customer corrects the address instead, call set_delivery_details with the corrected address rather than this tool.",
  input_schema: {
    type: "object",
    properties: {
      customerReply: {
        type: "string",
        description: "The customer's exact reply after hearing the address read back, verbatim.",
      },
    },
    required: ["customerReply"],
  },
};

function executeConfirmDeliveryAddress(order, input) {
  const { customerReply } = input || {};

  if (order.orderType !== "delivery" || !order.customer.address) {
    return {
      isError: true,
      content: "There is no delivery address on this order yet. Collect the delivery address first.",
    };
  }
  if (!isExplicitConfirmation(customerReply)) {
    return {
      isError: true,
      content: `"${customerReply}" is not a clear, unambiguous confirmation. Ask the customer to explicitly confirm the address or correct it — do not treat this reply as confirmation.`,
    };
  }

  order.customer.addressConfirmed = true;

  const location = `${order.customer.address}${order.customer.apartment ? `, ${order.customer.apartment}` : ""}`;
  return { isError: false, content: `Delivery address confirmed: ${location}.` };
}

module.exports = {
  setPickupDetailsTool,
  executeSetPickupDetails,
  setDeliveryDetailsTool,
  executeSetDeliveryDetails,
  confirmDeliveryAddressTool,
  executeConfirmDeliveryAddress,
};
