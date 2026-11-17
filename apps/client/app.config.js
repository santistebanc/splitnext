const { expo } = require('./app.json');
const { colors } = require('./src/design/tokens.ts');

module.exports = {
  expo: { ...expo, backgroundColor: colors.background },
};
