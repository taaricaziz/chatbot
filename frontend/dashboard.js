const STATUS_OPTIONS = ["NEW", "PREPARING", "READY", "COMPLETED"];

const ordersContainer = document.getElementById("ordersContainer");
const refreshBtn = document.getElementById("refreshBtn");

function createDetailRow(label, value) {
  const row = document.createElement("div");
  row.className = "order-detail";

  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;

  row.appendChild(strong);
  row.appendChild(document.createTextNode(value));
  return row;
}

function formatItems(items) {
  if (!items || !items.length) return "(no items)";
  return items
    .map((item) => {
      const optionsSummary = Object.values(item.options || {}).join(", ");
      return `${item.quantity}x ${item.size} ${item.name}${optionsSummary ? ` (${optionsSummary})` : ""}`;
    })
    .join(", ");
}

function formatFulfillment(order) {
  const customer = order.customer || {};
  if (order.orderType === "delivery") {
    const apt = customer.apartment ? `, ${customer.apartment}` : "";
    return `Delivery to ${customer.address || "(no address)"}${apt}`;
  }
  const time = customer.pickupTime ? ` at ${customer.pickupTime}` : "";
  return `Pickup${time}`;
}

function formatCustomer(order) {
  const customer = order.customer || {};
  const name = customer.name || "(no name)";
  if (order.orderType === "delivery") {
    return `${name} — ${customer.phone || "(no phone)"}`;
  }
  return name;
}

function buildOrderCard(order) {
  const card = document.createElement("div");
  card.className = "order-card";

  const header = document.createElement("div");
  header.className = "order-card-header";

  const idSpan = document.createElement("span");
  idSpan.className = "order-id";
  idSpan.textContent = order.orderId;

  const statusSpan = document.createElement("span");
  statusSpan.className = `order-status status-${String(order.status).toLowerCase()}`;
  statusSpan.textContent = order.status;

  header.appendChild(idSpan);
  header.appendChild(statusSpan);
  card.appendChild(header);

  card.appendChild(createDetailRow("Items", formatItems(order.items)));
  card.appendChild(createDetailRow("Fulfillment", formatFulfillment(order)));
  card.appendChild(createDetailRow("Customer", formatCustomer(order)));
  card.appendChild(createDetailRow("Total", `$${Number(order.total || 0).toFixed(2)}`));

  const controls = document.createElement("div");
  controls.className = "order-controls";

  const label = document.createElement("label");
  const selectId = `status-${order.orderId}`;
  label.setAttribute("for", selectId);
  label.textContent = "Update status:";

  const select = document.createElement("select");
  select.id = selectId;
  STATUS_OPTIONS.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    if (status === order.status) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener("change", () => updateStatus(order.orderId, select.value));

  controls.appendChild(label);
  controls.appendChild(select);
  card.appendChild(controls);

  return card;
}

function renderOrders(orders) {
  ordersContainer.innerHTML = "";

  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No orders yet.";
    ordersContainer.appendChild(empty);
    return;
  }

  const sorted = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sorted.forEach((order) => ordersContainer.appendChild(buildOrderCard(order)));
}

async function loadOrders() {
  try {
    const res = await fetch("/api/orders");
    const data = await res.json();
    renderOrders(data.orders || []);
  } catch (err) {
    ordersContainer.innerHTML = "";
    const errorMsg = document.createElement("p");
    errorMsg.className = "empty-state";
    errorMsg.textContent = "Failed to load orders.";
    ordersContainer.appendChild(errorMsg);
  }
}

async function updateStatus(orderId, status) {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Failed to update status: ${err.error || res.statusText}`);
    }
  } catch (err) {
    alert("Failed to update status: network error.");
  } finally {
    loadOrders();
  }
}

refreshBtn.addEventListener("click", loadOrders);
loadOrders();
