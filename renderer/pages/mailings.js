"use strict";

window.Pages.mailings = {
  async render(container) {
    const [mailings, allRecipients] = await Promise.all([window.api.listMailings(), window.api.listTracking()]);

    container.innerHTML = `
      <h1>Mailings</h1>
      <p class="subtitle">Review a mailing's split before sending. Sending emails goes out immediately; paper mailings generate print-ready letters for you to print and mail.</p>
      <div class="panel">
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Email</th><th>Paper</th><th>Responded</th><th></th></tr></thead>
          <tbody id="mailing-rows"></tbody>
        </table>
        <div id="mailing-empty" class="empty" style="display:none">No mailings yet — create one from "New Mailing".</div>
      </div>
    `;

    function statsFor(mailingId) {
      const rows = allRecipients.filter((r) => r.mailingId === mailingId);
      return {
        email: rows.filter((r) => r.channel === "email").length,
        paper: rows.filter((r) => r.channel === "paper").length,
        responded: rows.filter((r) => r.status === "responded").length,
        total: rows.length,
      };
    }

    function filtersHtml(mailing) {
      const rules = mailing.filterRules || [];
      if (rules.length === 0) {
        return `<p class="hint" style="margin:8px 4px">This mailing includes every contact — no filters were applied.</p>`;
      }
      return `
        <div style="padding:8px 4px">
          <p class="hint" style="margin:0 0 6px">Recipients were selected by:</p>
          <ul style="margin:0;padding-left:20px">
            ${rules
              .map(
                (r) =>
                  `<li>${escapeHtml(r.field)} <strong>${escapeHtml(filterOpLabel(r.op))}</strong>${
                    filterRuleNeedsValue(r.op) ? ` "${escapeHtml(r.value || "")}"` : ""
                  }</li>`
              )
              .join("")}
          </ul>
        </div>
      `;
    }

    function renderRows() {
      const body = qs("#mailing-rows", container);
      qs("#mailing-empty", container).style.display = mailings.length ? "none" : "block";
      body.innerHTML = mailings
        .map((m) => {
          const stats = statsFor(m.id);
          return `
        <tr>
          <td>${escapeHtml(m.name)}</td>
          <td><span class="badge badge-${m.status === "sent" ? "sent" : "pending"}">${m.status}</span></td>
          <td>${stats.email}</td>
          <td>${stats.paper}</td>
          <td>${stats.responded} / ${stats.total}</td>
          <td>
            <button class="btn" data-send="${m.id}" ${m.status === "sent" ? "disabled" : ""}>${
            m.status === "sent" ? "Sent" : "Send"
          }</button>
            <button class="btn secondary" data-test="${m.id}" type="button">Test</button>
            <button class="btn secondary" data-view="${m.id}">View tracking</button>
            <button class="btn secondary" data-filters="${m.id}" type="button">Filters</button>
            ${m.status === "sent" ? "" : `<button class="btn danger" data-delete="${m.id}" type="button">Delete</button>`}
          </td>
        </tr>
        <tr class="filters-row" id="filters-row-${m.id}" style="display:none"><td colspan="6"></td></tr>`;
        })
        .join("");

      qsa("[data-send]", body).forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (!(await confirmAction("Send this mailing now? Emails will go out and paper letters will be generated.", "Send"))) return;
          btn.disabled = true;
          btn.textContent = "Sending…";
          try {
            const result = await window.api.sendMailing(btn.dataset.send);
            toast(
              `Sent ${result.sent} email(s), generated ${result.generated} paper letter(s)` +
                (result.errors.length ? `, ${result.errors.length} error(s).` : ".")
            );
            if (result.errors.length) console.error(result.errors);
            navigate("mailings");
          } catch (err) {
            toast(`Send failed: ${err.message}`, true);
            btn.disabled = false;
            btn.textContent = "Send";
          }
        })
      );
      qsa("[data-test]", body).forEach((btn) =>
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          btn.textContent = "Sending…";
          try {
            const result = await window.api.sendTestMailing(btn.dataset.test);
            toast(`Test email sent to ${result.to}.`);
          } catch (err) {
            toast(`Test send failed: ${err.message}`, true);
          }
          btn.disabled = false;
          btn.textContent = "Test";
        })
      );
      qsa("[data-view]", body).forEach((btn) =>
        btn.addEventListener("click", () => {
          window.__trackingMailingFilter = btn.dataset.view;
          navigate("tracking");
        })
      );
      qsa("[data-filters]", body).forEach((btn) =>
        btn.addEventListener("click", () => {
          const mailing = mailings.find((m) => m.id === btn.dataset.filters);
          const row = qs(`#filters-row-${mailing.id}`, container);
          const isOpen = row.style.display !== "none";
          row.style.display = isOpen ? "none" : "table-row";
          if (!isOpen) row.querySelector("td").innerHTML = filtersHtml(mailing);
        })
      );
      qsa("[data-delete]", body).forEach((btn) =>
        btn.addEventListener("click", async () => {
          const mailing = mailings.find((m) => m.id === btn.dataset.delete);
          if (!(await confirmAction(`Delete "${mailing?.name || "this mailing"}"? This can't be undone.`, "Delete"))) return;
          btn.disabled = true;
          try {
            await window.api.deleteMailing(btn.dataset.delete);
            toast("Mailing deleted.");
            navigate("mailings");
          } catch (err) {
            toast(`Delete failed: ${err.message}`, true);
            btn.disabled = false;
          }
        })
      );
    }

    renderRows();
  },
};
