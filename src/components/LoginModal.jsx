const LoginModal = ({ onClose }) => {

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>TO-DO: Login with GitHub</h2>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
};

export default LoginModal;