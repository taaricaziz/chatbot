import { requireStaff } from "@/lib/auth";
import { formatPKR } from "@/lib/money";
import { getCategories, getMenu } from "@/lib/repositories/menu";
import { toggleAvailability, updatePrice } from "@/lib/services/admin-actions";
import styles from "./menu-admin.module.css";

export const dynamic = "force-dynamic";

export default async function MenuAdminPage() {
  const staff = await requireStaff();
  const [items, categories] = await Promise.all([getMenu(), getCategories()]);

  // Repricing is Manager+. Floor staff can take a dish off the board when the
  // kitchen runs out, but should not be able to change what it costs.
  const canReprice = staff.role === "MANAGER" || staff.role === "OWNER";
  const off = items.filter((i) => !i.isAvailable).length;

  return (
    <>
      <div className={styles.head}>
        <h1 className={`display ${styles.title}`}>Menu</h1>
        <p className={styles.muted}>
          {items.length} dishes · {off} off the board
          {!canReprice && " · prices are read-only for your role"}
        </p>
      </div>

      {categories.map((cat) => {
        const catItems = items.filter((i) => i.category === cat.name);
        if (catItems.length === 0) return null;

        return (
          <section key={cat.name} className={styles.section}>
            <h2 className={`eyebrow ${styles.catHead}`}>{cat.name}</h2>

            <ul className={styles.list} role="list">
              {catItems.map((item) => (
                <li
                  key={item.slug}
                  className={`${styles.row} ${item.isAvailable ? "" : styles.rowOff}`}
                >
                  <div className={styles.info}>
                    <span className={styles.name}>{item.name}</span>
                    <span className={styles.slug}>{item.slug}</span>
                  </div>

                  <div className={styles.priceCell}>
                    {canReprice ? (
                      <form action={updatePrice} className={styles.priceForm}>
                        <input type="hidden" name="slug" value={item.slug} />
                        <span className={styles.rs}>Rs.</span>
                        <input
                          type="number"
                          name="rupees"
                          defaultValue={Math.round(item.price / 100)}
                          min={0}
                          max={100000}
                          step={10}
                          className={styles.priceInput}
                          aria-label={`Price for ${item.name} in rupees`}
                        />
                        <button type="submit" className={styles.save}>
                          Save
                        </button>
                      </form>
                    ) : (
                      <span className={`price ${styles.readonlyPrice}`}>
                        {formatPKR(item.price)}
                      </span>
                    )}
                  </div>

                  <form action={toggleAvailability} className={styles.toggleForm}>
                    <input type="hidden" name="slug" value={item.slug} />
                    <input
                      type="hidden"
                      name="available"
                      value={item.isAvailable ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className={`${styles.toggle} ${item.isAvailable ? styles.on : styles.offBtn}`}
                    >
                      {item.isAvailable ? "On the board" : "86'd"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
