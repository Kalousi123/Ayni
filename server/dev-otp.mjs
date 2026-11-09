if (process.env.NODE_ENV === 'production') {
  throw new Error('El modo OTP local no se puede usar en producción.');
}

process.env.AYNI_DEV_OTP = '1';
