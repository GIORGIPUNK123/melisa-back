import axios from 'axios';
import moment from 'moment';

export const getUTCTime = async () => {
  try {
    const response = await axios.get(
      'http://worldtimeapi.org/api/timezone/Etc/UTC'
    );
    const utcTime = response.data.utc_datetime;
    const datetime = moment.utc(utcTime).format('YYYY-MM-DD HH:mm:ss');
    console.log(datetime);
    return datetime;
  } catch (err) {
    console.error('Error:', err);
  }
};
