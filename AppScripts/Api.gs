function handleApiGet_(e) {
  try {
    const action = e.parameter.action;
    if (action === 'ping') {
      return jsonResponse_({ pong: true });
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + action });
  } catch (err) {
    return jsonResponse_({ error: err.message });
  }
}

function handleApiPost_(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'ping') {
      return jsonResponse_({ pong: true, received: body });
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + body.action });
  } catch (err) {
    return jsonResponse_({ error: err.message });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
