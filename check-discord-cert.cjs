// check-discord-cert.cjs
const tls = require("tls");

const socket = tls.connect({
  host: "discord.com",
  port: 443,
  servername: "discord.com",
  rejectUnauthorized: false,   // <- wichtig: Zertifikat trotzdem akzeptieren
}, () => {
  console.log("Connected to discord.com\n");

  // komplette Zertifikatskette ausgeben
  let currentCert = socket.getPeerCertificate(true);
  let i = 0;
  while (currentCert) {
    console.log(`=== Certificate [${i}] ===`);
    console.log("Subject:", currentCert.subject);
    console.log("Issuer :", currentCert.issuer);
    console.log("Valid From:", currentCert.valid_from);
    console.log("Valid To  :", currentCert.valid_to);
    console.log("");
    if (!currentCert.issuerCertificate || currentCert === currentCert.issuerCertificate) break;
    currentCert = currentCert.issuerCertificate;
    i++;
  }

  socket.end();
});

socket.on("error", (err) => {
  console.error("TLS Error:", err);
});
