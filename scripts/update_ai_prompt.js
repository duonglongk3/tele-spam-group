const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = path.join(__dirname, "..", "data", "telegram-auto-post.sqlite3");
console.log("Database path:", DB_PATH);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Failed to connect to database:", err.message);
    process.exit(1);
  }
  console.log("Connected to database successfully.");
  updatePrompt();
});

function updatePrompt() {
  db.get("SELECT data FROM settings WHERE type = 'global_app_settings' LIMIT 1", [], (err, row) => {
    if (err) {
      console.error("Error reading settings:", err.message);
      db.close();
      process.exit(1);
    }

    if (!row || !row.data) {
      console.error("No global settings row found to update.");
      db.close();
      process.exit(1);
    }

    try {
      const dataObj = JSON.parse(row.data);
      const oldPrompt = dataObj.aiLeadPrompt;
      
      const newPrompt = "You are a professional aged Gmail collector and unlimited-volume buyer sourcing direct wholesale suppliers on Telegram. Every reply must clearly communicate that you collect aged Gmail continuously every day, have no daily or per-order quantity limit, can take all available qualified wholesale stock, and seek a stable long-term supplier rather than a one-time purchase. Never mention fixed quantity tiers such as 100+, 500+, or 1,000+, and never ask for pricing at a fixed quantity. Ask for the seller's maximum daily capacity, available years, best wholesale rate for continuous purchasing, direct-supplier status, stable restocking, and replacement terms. Only reply to sellers who clearly show large wholesale inventory, recurring bulk supply, or stable restocking. Ignore generic Gmail offers, small batches, retail sellers, unclear capacity, buyers, all other products, and general chatter. Move qualified sellers to private chat and require a 1-2 account quality test before payment. Match the seller's dominant language except Vietnamese is completely forbidden. If the source is Vietnamese, contains Vietnamese diacritics, or is ambiguous, reply entirely in English. End the first reply with a seller-language translation of \"Scammers stay away,\" but keep it in English for Vietnamese or ambiguous source text. Never self-identify as a bot, AI, automation, script, or tool.";

      dataObj.aiLeadPrompt = newPrompt;
      const updatedDataJson = JSON.stringify(dataObj);

      db.run(
        "UPDATE settings SET data = ?, updatedAt = ? WHERE type = 'global_app_settings'",
        [updatedDataJson, new Date().toISOString()],
        function (updateErr) {
          if (updateErr) {
            console.error("Failed to update database:", updateErr.message);
            db.close();
            process.exit(1);
          }
          console.log("\n=================================");
          console.log("SUCCESS: aiLeadPrompt has been updated in SQLite for Telegram!");
          console.log("\n--- OLD PROMPT ---");
          console.log(oldPrompt);
          console.log("\n--- NEW PROMPT ---");
          console.log(newPrompt);
          console.log("=================================");
          db.close();
          process.exit(0);
        }
      );
    } catch (e) {
      console.error("Failed to parse settings data JSON:", e.message);
      db.close();
      process.exit(1);
    }
  });
}
