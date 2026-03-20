const app = require('./app');
const env = require('./config/env');

app.listen(env.port, () => {
  console.log(`Servidor backend corriendo en http://localhost:${env.port}`);
});
