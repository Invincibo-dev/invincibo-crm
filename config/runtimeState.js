let ready = false;

const isReady = () => ready;
const markReady = () => {
  ready = true;
};
const markNotReady = () => {
  ready = false;
};

module.exports = { isReady, markReady, markNotReady };
