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
            <button class="btn secondary" data-view="${m.id}">View tracking</button>
            ${m.status === "sent" ? "" : `<button class="btn danger" data-delete="${m.id}" type="button">Delete</button>`}
          </td>
        </tr>`;
        })
        .join("");

      qsa("[data-send]", body).forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (!confirm("Send this mailing now? Emails will go out and paper letters will be generated.")) return;
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
      qsa("[data-view]", body).forEach((btn) =>
        btn.addEventListener("click", () => {
          window.__trackingMailingFilter = btn.dataset.view;
          navigate("tracking");
        })
      );
      qsa("[data-delete]", body).forEach((btn) =>
        btn.addEventListener("click", async () => {
          const mailing = mailings.find((m) => m.id === btn.dataset.delete);
          if (!confirm(`Delete "${mailing?.name || "this mailing"}"? This can't be undone.`)) return;
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
