const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Payout system listening on http://localhost:${PORT}`); // eslint-disable-line no-console
});
